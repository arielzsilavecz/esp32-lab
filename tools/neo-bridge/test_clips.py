import datetime
from pathlib import Path
import tempfile
import unittest

from bridge import buscar_grabacion


class GrabacionesTest(unittest.TestCase):
    def test_busca_segmento_y_rechaza_huecos(self):
        with tempfile.TemporaryDirectory() as carpeta:
            carpeta = Path(carpeta)
            (carpeta / '2026-11-13_21-00-00.mkv').touch()
            (carpeta / '2026-11-13_21-20-00.mkv').touch()
            (carpeta / 'invalido.mkv').touch()
            archivo, segundos = buscar_grabacion(carpeta, datetime.datetime(2026, 11, 13, 21, 0, 30))
            self.assertEqual(archivo.name, '2026-11-13_21-00-00.mkv')
            self.assertEqual(segundos, 30)
            with self.assertRaises(ValueError):
                buscar_grabacion(carpeta, datetime.datetime(2026, 11, 13, 21, 15))


if __name__ == '__main__':
    unittest.main()
