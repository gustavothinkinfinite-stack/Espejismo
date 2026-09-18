# Espejismo

Módulo para Foundry Virtual Tabletop que permite asignar una apariencia distinta del mismo token a cada jugador.

Repositorio oficial: <https://github.com/gustavothinkinfinite-stack/Espejismo>

## Compatibilidad

- Foundry VTT 13 o 14.
- Verificado contra la API de Foundry VTT 14.
- Independiente del sistema de juego: puede utilizarse con PF2e y otros sistemas.

## Funciones de la versión 1.0.1

- Imagen diferente para cada jugador.
- Nombre aparente diferente para cada jugador.
- Escala y opacidad individuales.
- Opción de ocultar el token a un jugador concreto.
- Interruptor general para pausar el módulo sin borrar configuraciones.
- Interruptor por token.
- Panel del GM con estado visible, número de tokens configurados y jugadores asignados.
- Indicador verde en el HUD cuando el token tiene percepciones activas.
- No modifica el Actor, HP, estadísticas, posición, combate ni tiradas.
- Los cambios se aplican localmente en el cliente de cada usuario.

## Instalación manual

1. Descomprimir `espejismo-v1.0.1.zip` dentro de la carpeta `Data/modules` de Foundry.
2. Reiniciar Foundry VTT.
3. Activar **Espejismo** en la configuración de módulos del mundo.

La ruta final debe quedar así:

`Data/modules/espejismo/module.json`

También puede instalarse desde Foundry usando esta URL de manifiesto:

`https://raw.githubusercontent.com/gustavothinkinfinite-stack/Espejismo/main/module.json`

## Uso

1. Entrar al mundo como GM.
2. Seleccionar la herramienta de tokens.
3. Pulsar el botón del ojo **Administrar percepciones**.
4. Elegir un token de la escena.
5. Activar la fila del jugador y seleccionar la imagen que verá.
6. Opcionalmente cambiar nombre, escala, opacidad u ocultarlo.
7. Pulsar **Guardar y aplicar**.

También puede abrirse el panel desde el botón del ojo incluido en el HUD del token.

## Notas

- La configuración se guarda en flags del TokenDocument; la apariencia real no se sustituye.
- El GM ve la apariencia real salvo que se le agregue una asignación mediante API.
- Si el módulo se pausa, todos vuelven a ver la representación real inmediatamente.
- Para probar percepciones distintas hay que abrir Foundry con usuarios diferentes en navegadores o perfiles separados.

## API básica

Cuando Foundry termina de iniciar, el módulo expone:

```js
Espejismo.openPanel();
Espejismo.applyAll();
Espejismo.applyToToken(canvas.tokens.controlled[0]);
Espejismo.getConfig(canvas.tokens.controlled[0]);
```

## Historial de cambios

### 1.0.1

- Corregida la escala de la apariencia percibida en Foundry VTT 13 y 14.
- La escala ahora utiliza `PrimarySpriteMesh.resize`, preserva la proporción de la imagen y respeta la escala base del token.

### 1.0.0

- Primera versión pública.
