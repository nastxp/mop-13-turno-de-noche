# MOP-13 · Turno de noche en el espacio

Simulador de conserje espacial con humor, ambientación biomecánica y dos estilos gráficos. Eres MOP-13, el conserje del turno de noche de la USC Desastre: friega, recoge, desatasca, captura fauna alienígena y sobrevive a incendios, brechas y jefes mientras la tripulación lo ensucia todo.

Hecho con **TypeScript**, **Phaser 3.90** y **Vite**. Todos los gráficos se generan por código (no hay imágenes en el repositorio).

## Características

- **Dos estilos gráficos**, a elegir en *Opciones → Estilo gráfico*:
  - **Bloques isométricos** (por defecto): personajes, muebles, puertas, criaturas, jefes y efectos modelados con bloques.
  - **Pixel art 3/4** (clásico).
- **Modos**: historia por noches, turno infinito, limpieza zen, modo caos y desafíos.
- **Multijugador cooperativo** de hasta 4 conserjes con un código de sala de 5 letras, con chat de voz.
- **Herramientas**: fregona, espuma, aspiradora, desinfectante, crio, trampa, robot y superfregona.
- **Fauna**: glorps, Rasgadores, babosas, ratas, insectos y aspiradoras rebeldes; contraatacan si les haces daño.
- **Jefes**: la Reina del Moho y el Rey Aspirador.
- Taquilla de mejoras, especializaciones, vestuario, logros y archivo secreto.

## Requisitos

- Node.js 18 o superior.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
```

Otros comandos:

```bash
npm run typecheck  # comprobación de tipos
npm run build      # compila en dist/
npm run preview    # sirve dist/ en http://localhost:4173
```

`gfx-preview.html` es un banco de pruebas gráfico para el desarrollo (no forma parte del juego compilado).

## Despliegue

La carpeta `deploy/` contiene un servidor Node.js sin dependencias (`server.js`). Sirve el juego compilado y hace de repetidor del multijugador (WebSocket en `/mp`, con sondeo HTTP como alternativa).

1. `npm run build`
2. Copia `dist/` dentro de `deploy/` (quedará `deploy/dist/`).
3. En el servidor: `cd deploy && npm start` (usa la variable `PORT`).

Las instrucciones detalladas para Hostinger (hPanel y VPS) están en [deploy/README.md](deploy/README.md).

## Controles

| Acción | Teclado y ratón |
|---|---|
| Moverse | WASD |
| Usar herramienta | Clic o Espacio |
| Interactuar | E |
| Cambiar de herramienta | Q o 1–8 |
| Mapa | M |

En pantallas táctiles aparecen controles en pantalla (se pueden forzar en *Opciones*).

## Estructura

```
src/
├── scenes/    escenas de Phaser (arranque y partida)
├── entities/  conserje, tripulación y criaturas
├── systems/   limpieza, emergencias, combate, jefes, iluminación, vista isométrica, guardado…
├── gfx/       generación de gráficos por código (pixel art y bloques isométricos)
├── data/      salas, herramientas, residuos, tripulación, misiones y textos
├── net/       multijugador (sincronización y voz)
├── ui/        interfaz HTML (menús, opciones, avisos)
├── world/     mapa de la nave
└── core/      utilidades (aleatoriedad con semilla, eventos)
deploy/        servidor Node.js para producción
```
