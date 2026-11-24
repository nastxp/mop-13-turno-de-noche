# MOP-13 · Turno de noche en el espacio — despliegue en Hostinger (Node.js)

Este paquete contiene el juego **ya compilado** (`dist/`) y un servidor Node.js **sin dependencias** (`server.js`).
No hace falta `npm install` ni ningún paso de compilación en el servidor.

El mismo servidor hace de **repetidor del multijugador cooperativo** (hasta 4 conserjes por sala, con un código de 5 letras).

```
mop13-hostinger/
├── server.js      ← servidor estático (brotli/gzip, caché, /healthz) + salas multijugador en /mp
├── package.json   ← "npm start" arranca el servidor · Node 18 o superior
├── dist/          ← el juego (HTML + JS + CSS)
└── README.md
```

## Opción A · Hosting web con Node.js (hPanel)

1. En **hPanel** entra en **Sitios web → Añadir sitio web → Aplicación Node.js** (o, en un sitio existente, en el apartado de aplicaciones Node.js).
2. Elige **subir archivos** y sube `mop13-hostinger.zip` tal cual.
3. Configura la aplicación:
   - **Versión de Node.js:** 18, 20 o 22.
   - **Archivo de entrada (entry file):** `server.js`
   - **Comando de compilación (build):** déjalo vacío. Si es obligatorio, usa `npm run build` (solo muestra un mensaje).
   - **Comando de inicio (start):** `npm start`
   - **Directorio raíz:** la carpeta donde quedan `server.js` y `dist/` tras descomprimir.
4. Pulsa **Desplegar**. Hostinger asigna el puerto con la variable `PORT`; el servidor ya la usa.
5. Abre tu dominio y comprueba que `https://tu-dominio/healthz` responde `ok · salas 0`.
6. Prueba el multijugador (ver más abajo). El juego usa **WebSocket** en `/mp`; si el alojamiento no lo deja pasar,
   cambia solo a **sondeo HTTP** (`/mp/open`, `/mp/send`, `/mp/recv`), así que funciona igualmente, con algo más de retardo.

> Si el panel muestra los nombres de los campos en inglés: *Entry file* = `server.js`, *Start command* = `npm start`, *Build command* = vacío.

## Opción B · VPS de Hostinger (Ubuntu)

```bash
# 1) Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs unzip

# 2) Sube y descomprime el paquete
mkdir -p /var/www/mop13 && cd /var/www/mop13
unzip ~/mop13-hostinger.zip

# 3) Arranca con PM2 (se reinicia solo y sobrevive a reinicios del VPS)
sudo npm install -g pm2
PORT=3000 pm2 start server.js --name mop13
pm2 save && pm2 startup
```

Después, apunta tu dominio con un proxy inverso (Nginx) hacia `http://127.0.0.1:3000`.
Las cabeceras `Upgrade` y `Connection` son **imprescindibles** para el WebSocket del multijugador:

```nginx
server {
  server_name tu-dominio.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;   # el servidor envía un ping cada 25 s
  }
}
```

Con HTTPS (`certbot --nginx`) no hay que cambiar nada más: el juego usa `wss://` automáticamente.

## Multijugador cooperativo

1. En el menú, pulsa **Multijugador cooperativo → Crear sala**. Aparece un **código de 5 caracteres** y el botón **Copiar enlace**.
2. Los demás abren el enlace (`https://tu-dominio/?sala=CODIGO`) o escriben el código en **Unirse**.
3. El anfitrión elige el modo (Historia, Infinito, Zen o Caos) y pulsa **Empezar**. Quien entre más tarde aparece directamente en la nave.

Cómo funciona:
- El **anfitrión** simula la nave entera (tripulación, criaturas, incendios, suciedad…). Su ordenador hace el trabajo pesado.
- Cada invitado mueve a su conserje en su pantalla y el anfitrión aplica sus herramientas: la suciedad que friega uno desaparece para todos.
- Si un conserje cae, Recursos Humanos envía un repuesto a los 10 s. El turno no termina.
- Al acabar, todos reciben el mismo informe y cada uno cobra créditos y experiencia en su propia partida guardada.
- Si el anfitrión se va, la sala se cierra y los invitados vuelven al menú.
- El servidor no guarda nada: las salas viven en memoria y desaparecen al reiniciar la aplicación.
- Cambiar de ventana o de pestaña **no pausa** la partida (la nave es de todos). Si el anfitrión deja su pestaña
  en segundo plano, la simulación sigue avanzando para los demás.

## Chat de voz

En la sala de espera (y en la pausa) hay un panel **VOZ** con el botón **Activar micrófono**:

- El navegador pide permiso para el micrófono la primera vez. **Solo funciona en HTTPS** (o en `localhost`): activa el
  certificado SSL del dominio en hPanel.
- **Modos:** *micrófono abierto* (la tecla **V** silencia y vuelve a activar) o *pulsar V para hablar*. En móvil, el
  botón del micrófono del HUD hace lo mismo.
- **Voz por proximidad** (opcional): a quien está lejos en la nave se le oye más bajo.
- Quien no tenga micrófono, o deniegue el permiso, entra igualmente y solo escucha.
- Mientras alguien habla, su nombre se ilumina en verde sobre su conserje y en la lista de la sala.

El audio va **directamente entre los navegadores** (WebRTC). El servidor del juego solo reenvía la señalización y
nunca recibe ni guarda la voz. Para encontrar el camino entre redes se usan los servidores STUN públicos de Google.

### Redes que bloquean la conexión directa (opcional: servidor TURN)

En algunas redes muy cerradas (algunas empresas o redes móviles) la conexión directa falla y el panel lo avisa con
«sin conexión». Para esos casos se puede añadir un servidor **TURN** (propio, por ejemplo coturn, o contratado) con
variables de entorno de la aplicación (en hPanel: *Variables de entorno* de la app Node.js; en un VPS: delante de `pm2 start`):

| Variable | Ejemplo |
|---|---|
| `TURN_URLS` | `turn:turn.tu-dominio.com:3478,turns:turn.tu-dominio.com:5349` |
| `TURN_USER` | `mop13` |
| `TURN_PASS` | `una-contraseña-larga` |
| `STUN_URLS` | (opcional) sustituye a los STUN de Google |

Puedes comprobar la configuración que reciben los navegadores en `https://tu-dominio/mp/ice`.

## Probar en tu ordenador

```bash
npm start
# abre http://localhost:3000
```

## Notas

- El juego carga las fuentes *Press Start 2P* y *VT323* desde Google Fonts. Sin conexión usa una fuente monoespaciada.
- Las partidas se guardan en el navegador del jugador (`localStorage`); el servidor no guarda nada.
- Para actualizar el juego, sustituye la carpeta `dist/` y reinicia la aplicación desde hPanel (o `pm2 restart mop13`).
- Reiniciar la aplicación cierra las salas abiertas: los jugadores tendrán que crear una nueva.
- La versión publicada como página estática (artifact) no tiene servidor, así que en ella el multijugador aparece desactivado.
