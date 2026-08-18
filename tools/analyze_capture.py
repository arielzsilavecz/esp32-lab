#!/usr/bin/env python3
"""Analizador de capturas RF (Etapa 4). Ver docs/decisions/0004-analisis-python.md.

No decodifica ningún protocolo: agrupa anchos de pulso por similitud, separa
huecos de trama de pulsos normales, y compara las tramas repetidas dentro de
una misma captura. La interpretación (qué cluster es "0" y cuál es "1") queda
para el humano.

Uso: python tools/analyze_capture.py docs/captures/archivo.csv
"""

from __future__ import annotations

import argparse
import csv
import statistics
from dataclasses import dataclass


@dataclass
class Edge:
    index: int
    timestamp_us: int
    duration_us: int
    level: int


def load_capture(path: str) -> list[Edge]:
    edges = []
    with open(path, newline="") as capture_file:
        for row in csv.DictReader(capture_file):
            edges.append(Edge(
                index=int(row["index"]),
                timestamp_us=int(row["timestamp_us"]),
                duration_us=int(row["duration_us"]),
                level=int(row["level"]),
            ))
    return edges


def pulse_widths_by_level(edges: list[Edge]) -> dict[int, list[int]]:
    """duration_us de la fila i es el ancho del pulso *anterior* al flanco, cuyo
    nivel es el opuesto de edges[i].level (cada flanco invierte el nivel). La
    fila 0 no tiene flanco previo (duration_us=0) y se descarta."""
    widths: dict[int, list[int]] = {0: [], 1: []}
    for edge in edges[1:]:
        widths[1 - edge.level].append(edge.duration_us)
    return widths


def cluster_1d(values: list[int], min_ratio: float) -> list[list[int]]:
    """Agrupa valores ordenándolos y cortando donde el salto relativo entre
    valores consecutivos supera min_ratio. Deliberadamente simple (no k-means,
    no nada probabilístico) para que el criterio sea auditable a mano."""
    if not values:
        return []
    ordered = sorted(values)
    clusters = [[ordered[0]]]
    for value in ordered[1:]:
        if value / clusters[-1][-1] > min_ratio:
            clusters.append([value])
        else:
            clusters[-1].append(value)
    return clusters


def cluster_stats(cluster: list[int]) -> dict[str, float]:
    return {
        "count": len(cluster),
        "min": min(cluster),
        "max": max(cluster),
        "mean": statistics.mean(cluster),
        "stdev": statistics.stdev(cluster) if len(cluster) > 1 else 0.0,
    }


def detect_frame_boundaries(edges: list[Edge], gap_ratio: float) -> tuple[list[int], float]:
    """Un hueco se considera borde de trama si dura más de gap_ratio veces la
    mediana de todas las duraciones. La mediana es robusta porque los huecos
    de trama son minoría frente a los pulsos normales."""
    durations = [edge.duration_us for edge in edges[1:]]
    if not durations:
        return [0], 0.0
    threshold = statistics.median(durations) * gap_ratio
    boundaries = [0]
    boundaries.extend(edge.index for edge in edges[1:] if edge.duration_us > threshold)
    return boundaries, threshold


def split_frames(edges: list[Edge], boundaries: list[int]) -> list[list[Edge]]:
    ends = boundaries[1:] + [len(edges)]
    return [edges[start:end] for start, end in zip(boundaries, ends)]


def symbol_means_by_level(edges: list[Edge], cluster_ratio: float) -> dict[int, list[float]]:
    """Media de cada cluster de ancho de pulso, por nivel — el "alfabeto" de
    símbolos candidatos que después se usa para clasificar cada pulso."""
    widths = pulse_widths_by_level(edges)
    return {
        level: [statistics.mean(cluster) for cluster in cluster_1d(widths[level], cluster_ratio)]
        for level in (0, 1)
    }


def assign_symbol(duration_us: int, pulse_level: int, symbol_means: dict[int, list[float]]) -> int:
    """Índice del cluster más cercano (nunca falla por jitter: -1 solo si no
    hay clusters para ese nivel, lo cual no debería pasar con datos reales)."""
    means = symbol_means[pulse_level]
    if not means:
        return -1
    return min(range(len(means)), key=lambda i: abs(duration_us - means[i]))


def frame_signature(frame: list[Edge], symbol_means: dict[int, list[float]]):
    """(nivel del primer flanco, secuencia de símbolos del resto de la trama).

    Comparar por símbolo (a qué cluster de ancho de pulso pertenece) en vez de
    por duración cruda es necesario: en la captura real hay deriva de reloj de
    cientos de µs a lo largo de la captura, así que ninguna repetición coincide
    en microsegundos exactos aunque sea el mismo código. El primer flanco de la
    trama es el borde detectado por detect_frame_boundaries — su duration_us es
    el hueco de silencio previo (varía mucho entre repeticiones, no es parte
    del código transmitido), así que de él solo se compara el nivel."""
    first_level = frame[0].level
    rest = tuple(
        (edge.level, assign_symbol(edge.duration_us, 1 - edge.level, symbol_means))
        for edge in frame[1:]
    )
    return (first_level, rest)


def build_report(edges: list[Edge], gap_ratio: float, cluster_ratio: float) -> str:
    lines: list[str] = []
    lines.append(f"Flancos totales: {len(edges)}")

    widths = pulse_widths_by_level(edges)
    for level in (1, 0):
        lines.append(f"\nAnchos de pulso, nivel {level} ({len(widths[level])} pulsos):")
        for cluster in cluster_1d(widths[level], cluster_ratio):
            stats = cluster_stats(cluster)
            lines.append(
                f"  cluster: n={stats['count']:<5} "
                f"min={stats['min']:.0f}us max={stats['max']:.0f}us "
                f"mean={stats['mean']:.1f}us stdev={stats['stdev']:.1f}us"
            )

    boundaries, threshold = detect_frame_boundaries(edges, gap_ratio)
    frames = split_frames(edges, boundaries)
    lines.append(f"\nUmbral de hueco de trama: {threshold:.0f}us (>{gap_ratio}x mediana)")
    lines.append(f"Tramas detectadas: {len(frames)}")

    symbol_means = symbol_means_by_level(edges, cluster_ratio)
    signatures = [frame_signature(frame, symbol_means) for frame in frames]
    # Grupo de referencia: la firma más común, no la trama 0 (que suele ser un
    # fragmento parcial de ruido/preámbulo, no una repetición real).
    most_common_signature = max(set(signatures), key=signatures.count)
    for i, (frame, signature) in enumerate(zip(frames, signatures)):
        duration_us = frame[-1].timestamp_us - frame[0].timestamp_us if len(frame) > 1 else 0
        equal_to_common = "==" if signature == most_common_signature else "!="
        lines.append(
            f"  trama {i}: {len(frame)} flancos, {duration_us}us de duracion, "
            f"{equal_to_common} patron mas comun"
        )
    unique_signatures = set(signatures)
    matching_common = sum(1 for s in signatures if s == most_common_signature)
    lines.append(f"\nSecuencias de trama distintas encontradas: {len(unique_signatures)}")
    lines.append(f"Tramas que coinciden con el patron mas comun: {matching_common}/{len(frames)}")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_csv", help="CSV exportado por el firmware (Etapa 3)")
    parser.add_argument("--gap-ratio", type=float, default=5.0,
                         help="múltiplo de la mediana para considerar un hueco como borde de trama (default: 5.0)")
    parser.add_argument("--cluster-ratio", type=float, default=1.3,
                         help="salto relativo mínimo entre valores consecutivos para separar clusters (default: 1.3)")
    parser.add_argument("--report", help="si se pasa, además escribe el reporte en este archivo")
    args = parser.parse_args()

    edges = load_capture(args.capture_csv)
    report = build_report(edges, args.gap_ratio, args.cluster_ratio)
    print(report)

    if args.report:
        with open(args.report, "w") as report_file:
            report_file.write(report + "\n")


if __name__ == "__main__":
    main()
