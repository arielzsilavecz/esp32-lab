import unittest
from unittest.mock import Mock, patch

import vigilancia


class VigilanciaPermanenteTest(unittest.TestCase):
    def analizar_una_deteccion(self, avisos_activos):
        camara = vigilancia.Vigilancia.__new__(vigilancia.Vigilancia)
        camara.activa = True
        camara.avisos_activos = avisos_activos
        camara.ajustes = vigilancia.AJUSTES
        camara.nombre = 'Prueba'
        camara.url_llm = 'http://localhost'
        camara.foto_disparo = (b'foto', 1731540000.0)
        camara.disparo = Mock()
        camara.disparo.wait.side_effect = [None, StopIteration]
        camara.subir = Mock()
        camara.evento = Mock()
        camara.reforzado = Mock(return_value=False)
        with patch.object(vigilancia, 'temperatura_c', return_value=30), \
             patch.object(vigilancia.time, 'monotonic', return_value=1000), \
             patch.object(vigilancia, 'analizar', return_value={
                 'persona': True, 'vehiculo': False, 'descripcion': ''}):
            with self.assertRaises(StopIteration):
                camara._analizar_siempre()
        return camara

    def test_deteccion_se_registra_sin_generar_aviso(self):
        camara = self.analizar_una_deteccion(False)
        camara.subir.assert_called_once_with(b'foto', 'registro', 'Persona en la entrada', 1731540000.0)

    def test_deteccion_mantiene_aviso_cuando_esta_habilitado(self):
        camara = self.analizar_una_deteccion(True)
        camara.subir.assert_called_once_with(b'foto', 'deteccion', 'Persona en la entrada', 1731540000.0)


if __name__ == '__main__':
    unittest.main()
