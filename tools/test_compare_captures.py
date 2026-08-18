"""Valida el veredicto fijo/rolling sobre datos sintéticos, donde la respuesta
se conoce de antemano. Es la red de seguridad de una herramienta que decide si
el proyecto sigue por el camino del replay o hay que replantearlo."""

import os
import tempfile
import unittest

from compare_captures import build_report

SHORT_US = 450
LONG_US = 950
GAP_US = 11000


def write_capture(path, bits, repetitions=6):
    """Genera un CSV con `repetitions` repeticiones de la misma trama.

    Codificación PWM clásica: bit 1 = pulso alto largo + bajo corto;
    bit 0 = alto corto + bajo largo. Cada trama va precedida de un silencio."""
    pulses = []
    for _ in range(repetitions):
        pulses.append((0, GAP_US))
        for bit in bits:
            pulses.append((1, LONG_US if bit else SHORT_US))
            pulses.append((0, SHORT_US if bit else LONG_US))

    # duration_us de la fila i es el ancho del pulso previo, cuyo nivel es el
    # opuesto al de la fila -> level(fila k) = 1 - nivel_del_pulso_k.
    rows = ["index,timestamp_us,duration_us,level"]
    timestamp = 1000
    rows.append(f"0,{timestamp},0,{pulses[0][0]}")
    for index, (pulse_level, duration) in enumerate(pulses, start=1):
        timestamp += duration
        rows.append(f"{index},{timestamp},{duration},{1 - pulse_level}")

    with open(path, "w") as capture_file:
        capture_file.write("\n".join(rows) + "\n")


class VerdictTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def _path(self, name):
        return os.path.join(self.tmpdir, name)

    def test_identical_presses_report_fixed_code(self):
        bits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1]
        paths = [self._path(f"fija{i}.csv") for i in range(3)]
        for path in paths:
            write_capture(path, bits)

        report = build_report(paths, gap_ratio=5.0, cluster_ratio=1.3)
        self.assertIn("MISMA trama", report)
        self.assertIn("codigo FIJO", report)
        self.assertNotIn("ROLLING", report.split("VEREDICTO")[1])

    def test_changing_presses_report_rolling_code(self):
        base = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1]
        paths = []
        for i in range(3):
            bits = list(base)
            bits[-1] = (bits[-1] + i) % 2  # el "contador" cambia entre pulsaciones
            bits[-2] = (bits[-2] + i) % 2
            path = self._path(f"rolling{i}.csv")
            write_capture(path, bits)
            paths.append(path)

        report = build_report(paths, gap_ratio=5.0, cluster_ratio=1.3)
        self.assertIn("CAMBIA entre pulsaciones", report)
        self.assertIn("ROLLING CODE", report)

    def test_reports_which_symbols_differ(self):
        base = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1]
        changed = list(base)
        changed[0] = 0
        path_a, path_b = self._path("a.csv"), self._path("b.csv")
        write_capture(path_a, base)
        write_capture(path_b, changed)

        report = build_report([path_a, path_b], gap_ratio=5.0, cluster_ratio=1.3)
        self.assertIn("DISTINTA en", report)


if __name__ == "__main__":
    unittest.main()
