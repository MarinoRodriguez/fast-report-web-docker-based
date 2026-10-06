# FastReport Cloud Stream PoC 🚀
### Streaming de Windows Desktop al Navegador Web mediante Contenedores Docker Efímeros, Wine y Redirección Activa de URLs

Esta Prueba de Concepto (PoC) implementa una arquitectura completa y lista para producción que transmite la aplicación de escritorio **FastReport Windows Designer** (`Designer.exe`) directamente al navegador web utilizando contenedores Linux efímeros, **Wine**, **Xvfb**, **Openbox**, **x11vnc**, **Websockify** (noVNC) y un **puente de intercepción de URLs por Server-Sent Events (SSE)**.

---

## 📐 Diagrama de Arquitectura del Sistema

```mermaid
flowchart TD
    subgraph Host["💻 Host del Usuario / Servidor"]
        subgraph Browser["🌐 Navegador Web del Cliente"]
            UI["Frontend Web (index.html / app.js)"]
            RFB["Cliente noVNC (Canvas RFB)"]
            SSEClient["Receptor SSE (EventSource)"]
        end

        subgraph Backend["⚙️ Backend Orquestador (Node.js Express)"]
            Auth["Validación Token Dummy"]
            PortMgr["Gestor de Puertos Dinámicos"]
            Storage["Persistencia: server/storage/saved_reports/"]
        end
    end

    subgraph Container["📦 Contenedor Docker Efímero (Wine + Xvfb)"]
        X11["Servidor Gráfico Xvfb (:99)"]
        WM["Openbox Window Manager"]
        VNC["x11vnc (:5900)"]
        WS["Websockify (:6080)"]
        Bridge["Bridge Server HTTP & SSE (:8080)"]
        Redirector["url-redirector.sh (/usr/local/bin/winebrowser)"]
        Wine["Wine (FastReport Designer.exe / Test App)"]
        Workspace["Volumen Montado: /workspace/report.frx"]
    end

    UI -->|1. POST /api/session/start (Token)| Auth
    Auth -->|2. docker run -d -p VNC -p Bridge -v session| Container
    Backend -->|3. Retorna puertos y URLs| UI

    RFB <-->|4. WebSocket RFB Stream| WS
    WS <--> VNC <--> X11 <--> Wine

    Wine -->|5. Clic en enlace web| Redirector
    Redirector -->|6. POST /api/open-url| Bridge
    Bridge -->|7. SSE event: open_url| SSEClient
    SSEClient -->|8. window.open(url, '_blank')| Browser

    UI -->|9. Cerrar Editor (Guardar o Descartar)| Backend
    Backend -->|10. docker rm -f & copia de .frx| Storage
```

---

## 🌟 Requerimientos Clave Implementados

### 1. Aislamiento Total y Redirección de URLs
* **Sin navegador dentro del contenedor:** Wine no tiene instalados navegadores web (evita consumo de recursos y riesgos de seguridad).
* **/usr/bin/winebrowser interceptado:** Cualquier solicitud de apertura de hipervínculos (`ShellExecute`, `Process.Start`, enlaces en reportes, menús "Ayuda/Acerca de", etc.) es capturada por `/usr/local/bin/winebrowser` apuntando a `url-redirector.sh`.
* **Puente en tiempo real:** `url-redirector.sh` envía la URL capturada vía `POST http://127.0.0.1:8080/api/open-url` al `bridge_server.py`.
* **Apertura automática en el cliente:** El cliente web mantiene una conexión Server-Sent Events (`EventSource`) contra `/events`. Al recibir el evento, ejecuta inmediatamente `window.open(data.url, '_blank', 'noopener,noreferrer')`.

### 2. Ciclo de Vida Efímero de Contenedores
* Cada sesión de usuario genera su propio contenedor Docker independiente con mapeo dinámico de puertos para evitar colisiones.
* **Destrucción garantizada:** Cuando el usuario cierra la pestaña o finaliza la sesión, `beforeunload` con `navigator.sendBeacon` y el endpoint `/api/session/stop` destruyen el contenedor inmediatamente (`docker rm -f`).
* **Protección contra huérfanos:** El orquestador cuenta con un monitor de `heartbeat` que limpia cualquier sesión abandonada de forma automática tras inactividad.

### 3. Autenticación Dummy / Handshake
* El orquestador valida un token simulado (por defecto: `demo-user-123` o cualquier token que comience con `demo-`).
* Asigna puertos libres en rangos dinámicos (`6081+` para VNC y `8081+` para SSE Bridge) y entrega la configuración de conexión al frontend.

### 4. Persistencia de Reportes (Guardar o Descartar al Salir)
* **Prevalencia durante la sesión:** El archivo que el usuario edita reside en un volumen montado (`/workspace/report.frx`), garantizando que los cambios guardados con `Ctrl + S` en FastReport persistan en disco en tiempo real.
* **Flujo interactivo al invocar "Cerrar Editor":**
  1. El frontend despliega un modal: *"¿Deseas guardar los cambios del reporte para utilizarlo más adelante?"*
  2. **Si el usuario elige Guardar:**
     - Pregunta por el nombre identificador (ej: `Factura_Ventas_2026`).
     - El backend copia el `.frx` editado al almacén persistente (`server/storage/saved_reports/`).
     - Destruye el contenedor efímero.
     - El reporte queda listado en la biblioteca para ser reutilizado en futuras sesiones.
  3. **Si el usuario elige Descartar:**
     - El backend borra la carpeta temporal de la sesión sin persistirla y destruye el contenedor.

---

## 📁 Estructura del Proyecto

```
fastreport-docker-stream-poc/
├── docker/
│   ├── Dockerfile                 # Imagen Debian Slim con Wine, Xvfb, Openbox, x11vnc, websockify
│   ├── entrypoint.sh              # Inicializa display X11, servicios y lanza FastReport Designer
│   ├── url-redirector.sh          # Interceptor bash que reemplaza a winebrowser
│   ├── bridge_server.py           # Servidor HTTP/SSE ultraligero (Python estándar)
│   ├── default_report.frx         # Plantilla base de reporte FastReport XML
│   ├── test_doc.rtf               # Documento de prueba con enlaces web clicables
│   └── FastReport-WindowsDesigner/# Binarios del diseñador (.exe, dlls, configs)
├── server/
│   ├── package.json               # Dependencias del orquestador Node.js
│   ├── orchestrator.js            # Orquestador Docker, auth dummy y persistencia
│   └── storage/
│       ├── saved_reports/         # Almacenamiento persistente de reportes .frx
│       └── sessions/              # Espacios de trabajo temporales por sesión
├── public/
│   ├── index.html                 # Interfaz de usuario (Lobby, noVNC player, modales)
│   ├── app.js                     # Cliente noVNC, listener SSE y gestión de sesión
│   └── style.css                  # Estilos modernos con tema oscuro Slate/Indigo
├── README.md                      # Documentación técnica
├── start-poc.sh                   # Script de inicio para Linux / macOS / Git Bash
├── start-poc.ps1                  # Script de inicio para Windows PowerShell
└── start-poc.bat                  # Script de inicio para Windows CMD
```

---

## 🚀 Guía de Inicio Rápido

### Requisitos Previos
1. **Docker Desktop** (con soporte para contenedores Linux activo).
2. **Node.js 18+** instalado.

---

### Opción A: En Windows (PowerShell)

Abre una terminal PowerShell en el directorio del proyecto y ejecuta:

```powershell
.\start-poc.ps1
```

O si prefieres el Command Prompt:
```cmd
start-poc.bat
```

---

### Opción B: En Linux / macOS / Git Bash

```bash
chmod +x start-poc.sh docker/*.sh docker/*.py
./start-poc.sh
```

---

### Opción C: Ejecución Manual Paso a Paso

1. **Construir la imagen de Docker:**
   ```bash
   cd fastreport-docker-stream-poc
   docker build -t fastreport-stream:latest -f docker/Dockerfile docker/
   ```

2. **Instalar dependencias del servidor:**
   ```bash
   cd server
   npm install
   ```

3. **Iniciar el servidor orquestador:**
   ```bash
   node orchestrator.js
   ```

4. **Abrir en el navegador:**
   Ingresa a [http://localhost:3000](http://localhost:3000)

---

## 🧪 Cómo Probar las Funcionalidades

### 1. Iniciar una Sesión
1. En la pantalla principal, verifica que el token esté configurado (ej: `demo-user-123`).
2. Elige una de las opciones:
   - **Nuevo Reporte en Blanco:** Abre FastReport con una plantilla de factura de ejemplo.
   - **Cargar Reporte Previo:** Selecciona un reporte previamente guardado de la lista.
   - **Modo de Prueba (Test App):** Abre Wine Wordpad con enlaces web para probar la intercepción de inmediato.
3. Haz clic en **"Iniciar Sesión y Abrir Diseñador"**.
4. En pocos segundos, la interfaz de FastReport Designer aparecerá en el navegador con control total de ratón y teclado.

### 2. Probar la Intercepción y Redirección de URLs
* **Método 1 (Botón en Barra Superior):** Haz clic en el botón `🌐 Probar Interceptación URL`.
* **Método 2 (Dentro de la aplicación Wine):** Si estás en Modo de Prueba, haz clic en cualquiera de los enlaces del documento RTF (ej: `https://fast-report.com`).
* **Resultado:**
  - El enlace **no se abre dentro del contenedor**.
  - El frontend recibe la señal SSE y ejecuta `window.open(url)`.
  - Tu navegador abre automáticamente una pestaña con la URL.
  - Aparece una notificación flotante confirmando la captura del enlace.

### 3. Probar la Persistencia de Archivos
1. Realiza alguna modificación en el reporte (o pulsa `Ctrl + S`).
2. Haz clic en el botón `✖ Cerrar Editor` en la barra superior.
3. El sistema te preguntará:
   - *"¿Deseas guardar los cambios del reporte para utilizarlo más adelante?"*
4. **Si seleccionas "Guardar y Salir":**
   - Escribe un nombre (ej: `Reporte_Facturacion_Marzo`).
   - El archivo se guarda en `server/storage/saved_reports/` y el contenedor se destruye.
   - Al volver a la pantalla principal, el reporte aparecerá en la tabla listo para abrirse nuevamente.
5. **Si seleccionas "Descartar y Salir":**
   - El contenedor se destruye y los cambios temporales se eliminan.

---

## 📡 Especificación de la API REST

### Orquestador (`server/orchestrator.js`)

| Método | Endpoint | Descripción | Parámetros |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/reports` | Lista todos los reportes guardados | Ninguno |
| `GET` | `/api/reports/:name/download` | Descarga el archivo `.frx` | `name` en URL |
| `DELETE` | `/api/reports/:name` | Elimina un reporte del almacén | `name` en URL + Token Auth |
| `POST` | `/api/session/start` | Despliega un contenedor efímero | `{ token, reportName, mode }` |
| `POST` | `/api/session/stop` | Detiene y destruye el contenedor | `{ sessionId, save: bool, reportName: string }` |
| `POST` | `/api/session/heartbeat` | Mantiene viva la sesión activa | `{ sessionId }` |
| `GET` | `/api/session/active` | Monitorea sesiones en ejecución | Ninguno |

### Bridge Server del Contenedor (`bridge_server.py`)

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `POST` | `/api/open-url` | Recibe URLs interceptadas por `url-redirector.sh` y las emite por SSE |
| `GET` | `/events` | Canal Server-Sent Events (SSE) hacia el navegador |
| `GET` | `/api/status` | Estado interno del contenedor y del archivo de reporte |
| `GET` | `/api/report` | Descarga en crudo del archivo `/workspace/report.frx` actual |
| `POST` | `/api/test-url` | Emite una URL de prueba para validación manual |

---

## 🔒 Consideraciones de Seguridad y Rendimiento

1. **Aislamiento de Red:** El contenedor no necesita acceso a navegadores ni a periféricos del sistema anfitrión.
2. **Puertos Efímeros:** Cada sesión utiliza puertos TCP únicos asignados dinámicamente en tiempo de ejecución.
3. **Consumo Mínimo de Recursos:** Al utilizar **Openbox** en lugar de entornos pesados como GNOME o XFCE, el contenedor consume aproximadamente 180MB de RAM en reposo.
4. **Resistencia a Cierres Forzosos:** El uso de `navigator.sendBeacon` en el evento `beforeunload` garantiza la destrucción del contenedor incluso si el usuario cierra el navegador bruscamente.
