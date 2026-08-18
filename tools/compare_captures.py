#!/usr/bin/env python3
"""Compara la trama dominante entre varias capturas (Etapa 5).

Responde la pregunta que decide si el portón se puede abrir por replay:

  - **código fijo**: todas las pulsaciones transmiten la misma trama. Capturar
    una vez y retransmitirla alcanza.
  - **rolling code**: cada pulsación usa un contador distinto que el receptor
    invalida después de usarlo. Una captura vieja no sirve para abrir.

Ojo con el error clásico: que las repeticiones *dentro de una misma pulsación*
sean idénticas no prueba nada — un rolling code también repite el mismo código
mientras mantenés el botón apretado. Por eso este script compara entre
archivos, cada uno de una pulsación separada.

Uso: python tools/compare_captures.py captura1.csv captura2.csv captura3.csv
"""

from __future__ import annotations

import argparse
import statistics

from analyze_capture import (
    Edge,
    assign_symbol,
    cluster_1d,
    detect_frame_boundaries,
    frame_signature,
    load_capture,
    pulse_widths_by_level,
    split_frames,
)


def pooled_symbol_means(captures: list[list[Edge]], cluster_ratio: float) -> dict[int, list[float]]:
    """Alfabeto de símbolos calculado sobre todas las capturas juntas.

    Imprescindible para comparar entre archivos: si cada captura calculara sus
    propios clusters, dos tramas idénticas podrían clasificarse distinto solo
    porque el ruido de una captura corrió una media unos µs."""
    combined: dict[int, list[int]] = {0: [], 1: []}
    for edges in captures:
        widths = pulse_widths_by_level(edges)
        for level in (0, 1):
            combined[level].extend(widths[level])
    return {
        level: [statistics.mean(cluster) for cluster in cluster_1d(combined[level], cluster_ratio)]
        for level in (0, 1)
    }


def dominant_frame(edges: list[Edge], gap_ratio: float, symbol_means: dict[int, list[float]]):
    """Trama más repetida de una captura, junto con cuántas veces aparece."""
    boundaries, _ = detect_frame_boundaries(edges, gap_ratio)
    frames = split_frames(edges, boundaries)
    signatures = [frame_signature(frame, symbol_means) for frame in frames]
    most_common = max(set(signatures), key=signatures.count)
    frame = next(f for f, s in zip(frames, signatures) if s == most_common)
    return most_common, frame, signatures.count(most_common), len(frames)


def render_signature(signature) -> str:
    """Nivel inicial + secuencia de símbolos. El nivel de cada pulso alterna
    solo, así que la secuencia de índices ya identifica la trama entera."""
    first_level, rest = signature
    symbols = "".join(str(symbol) for _, symbol in rest)
    return f"start={first_level} n={len(rest)} [{symbols}]"


def diff_positions(sig_a, sig_b) -> list[int]:
    _, rest_a = sig_a
    _, rest_b = sig_b
    return [i for i, (a, b) in enumerate(zip(rest_a, rest_b)) if a != b]


def build_report(paths: list[str], gap_ratio: float, cluster_ratio: float) -> str:
    captures = [load_capture(path) for path in paths]
    symbol_means = pooled_symbol_means(captures, cluster_ratio)

    lines: list[str] = []
    lines.append(f"Capturas comparadas: {len(paths)}")
    lines.append("Alfabeto de simbolos (medias, calculado sobre todas las capturas juntas):")
    for level in (1, 0):
        means = ", ".join(f"[{i}]={m:.0f}us" for i, m in enumerate(symbol_means[level]))
        lines.append(f"  nivel {level}: {means}")

    results = []
    lines.append("")
    for path, edges in zip(paths, captures):
        signature, frame, matching, total = dominant_frame(edges, gap_ratio, symbol_means)
        results.append((path, signature))
        lines.append(f"{path}")
        lines.append(f"  flancos={len(edges)}  tramas={total}  repeticiones de la dominante={matching}")
        lines.append(f"  {render_signature(signature)}")

    lines.append("")
    lines.append("=== COMPARACION ENTRE CAPTURAS ===")
    reference_path, reference_signature = results[0]
    all_equal = True
    for path, signature in results[1:]:
        if signature == reference_signature:
            lines.append(f"  {path}: IDENTICA a {reference_path}")
            continue
        all_equal = False
        _, rest_ref = reference_signature
        _, rest_cur = signature
        if len(rest_ref) != len(rest_cur):
            lines.append(f"  {path}: DISTINTA (largo {len(rest_cur)} vs {len(rest_ref)})")
        else:
            positions = diff_positions(reference_signature, signature)
            lines.append(
                f"  {path}: DISTINTA en {len(positions)}/{len(rest_ref)} simbolos "
                f"(posiciones: {positions[:20]}{'...' if len(positions) > 20 else ''})"
            )

    lines.append("")
    if all_equal:
        lines.append("VEREDICTO: todas las pulsaciones transmiten la MISMA trama.")
        lines.append("Consistente con codigo FIJO -> el replay deberia funcionar.")
    else:
        lines.append("VEREDICTO: la trama CAMBIA entre pulsaciones.")
        lines.append("Consistente con ROLLING CODE -> el replay de una captura vieja no va a abrir.")
    lines.append("(Con 2-3 pulsaciones esto es fuerte pero no definitivo: un rolling code")
    lines.append(" siempre cambia, pero conviene confirmar con mas pulsaciones si hay dudas.)")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_csv", nargs="+", help="dos o mas CSV, cada uno de una pulsacion separada")
    parser.add_argument("--gap-ratio", type=float, default=5.0)
    parser.add_argument("--cluster-ratio", type=float, default=1.3)
    parser.add_argument("--report", help="si se pasa, ademas escribe el reporte en este archivo")
    args = parser.parse_args()

    if len(args.capture_csv) < 2:
        parser.error("hacen falta al menos 2 capturas para comparar")

    report = build_report(args.capture_csv, args.gap_ratio, args.cluster_ratio)
    print(report)

    if args.report:
        with open(args.report, "w") as report_file:
            report_file.write(report + "\n")


if __name__ == "__main__":
    main()
