import unittest

from analyze_capture import (
    Edge,
    cluster_1d,
    detect_frame_boundaries,
    frame_signature,
    split_frames,
    symbol_means_by_level,
)


class ClusterTests(unittest.TestCase):
    def test_separates_well_spaced_clusters(self):
        values = [500, 510, 490, 950, 960, 940]
        clusters = cluster_1d(values, min_ratio=1.3)
        self.assertEqual(len(clusters), 2)

    def test_keeps_close_values_in_one_cluster(self):
        values = [500, 505, 495, 510]
        clusters = cluster_1d(values, min_ratio=1.3)
        self.assertEqual(len(clusters), 1)

    def test_empty_input(self):
        self.assertEqual(cluster_1d([], min_ratio=1.3), [])


class FrameBoundaryTests(unittest.TestCase):
    def _edges(self):
        # Dos tramas "limpias" (4 flancos c/u, cantidad par para que la
        # paridad de nivel se preserve entre repeticiones, como en una
        # captura real) precedidas por un fragmento inicial arbitrario.
        return [
            Edge(0, 0, 0, 1),
            Edge(1, 500, 500, 0),
            Edge(2, 21000, 20500, 1),   # hueco grande -> arranca trama 1
            Edge(3, 21500, 500, 0),
            Edge(4, 22000, 500, 1),
            Edge(5, 22500, 500, 0),
            Edge(6, 43000, 20500, 1),   # hueco grande -> arranca trama 2
            Edge(7, 43500, 500, 0),
            Edge(8, 44000, 500, 1),
            Edge(9, 44500, 500, 0),
        ]

    def test_detects_large_gap_as_boundary(self):
        boundaries, _ = detect_frame_boundaries(self._edges(), gap_ratio=5.0)
        self.assertEqual(boundaries, [0, 2, 6])

    def test_split_frames_matches_boundaries(self):
        edges = self._edges()
        boundaries, _ = detect_frame_boundaries(edges, gap_ratio=5.0)
        frames = split_frames(edges, boundaries)
        self.assertEqual([len(f) for f in frames], [2, 4, 4])

    def test_identical_repeated_frames_have_equal_signature(self):
        edges = self._edges()
        boundaries, _ = detect_frame_boundaries(edges, gap_ratio=5.0)
        _, frame_a, frame_b = split_frames(edges, boundaries)
        symbol_means = symbol_means_by_level(edges, cluster_ratio=1.3)
        self.assertEqual(frame_signature(frame_a, symbol_means), frame_signature(frame_b, symbol_means))

    def test_frame_signature_tolerates_jitter_within_cluster(self):
        # Mismo patrón que _edges() pero con +-15us de jitter en cada pulso:
        # debe seguir matcheando por símbolo aunque no matchee en microsegundos crudos.
        edges = [
            Edge(0, 0, 0, 1),
            Edge(1, 500, 500, 0),
            Edge(2, 21000, 20500, 1),
            Edge(3, 21500, 512, 0),
            Edge(4, 22000, 489, 1),
            Edge(5, 22500, 505, 0),
            Edge(6, 43000, 20500, 1),
            Edge(7, 43500, 494, 0),
            Edge(8, 44000, 511, 1),
            Edge(9, 44500, 497, 0),
        ]
        boundaries, _ = detect_frame_boundaries(edges, gap_ratio=5.0)
        _, frame_a, frame_b = split_frames(edges, boundaries)
        symbol_means = symbol_means_by_level(edges, cluster_ratio=1.3)
        self.assertEqual(frame_signature(frame_a, symbol_means), frame_signature(frame_b, symbol_means))


if __name__ == "__main__":
    unittest.main()
