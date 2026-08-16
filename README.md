# Red de Apoyo — quieroayudar.co

Plataforma para coordinar ayuda humanitaria en Colombia: conecta centros de acopio con quienes quieren donar o ser voluntarios, y evita que la ayuda se duplique en unos puntos mientras falta en otros.

- **PWA:** `https://quieroayudar.co`
- **API:** `https://api.quieroayudar.co`

## Qué resuelve

En una emergencia el problema no suele ser la falta de ayuda, sino la falta de información: nadie sabe qué centro necesita qué, cuál ya está saturado, ni cuánto de lo prometido va a llegar de verdad. La Red de Apoyo mantiene ese estado en un solo lugar.

- **Centros de acopio** con ubicación, horario, contacto, fuente de verificación y bandera de saturación de voluntarios.
- **Necesidades** por centro, con prioridad, meta, cantidad cubierta y unidad.
- **Compromisos** con vencimiento: si alguien promete algo y no llega, la necesidad vuelve a quedar abierta en vez de figurar como cubierta.
- **Solicitudes de voluntarios** por centro y tipo de tarea.
- **Reportes de campo** para que quien está en terreno avise de novedades.

## Arquitectura

- **API:** FastAPI + SQLAlchemy sobre MySQL 8.4, en contenedores Docker.
- **PWA:** Next/vinext, instalable y con service worker. Sus rutas `/api/*` son un proxy delgado hacia la API para conservar el mismo contrato en el navegador.
- **Borde:** Nginx termina TLS y aplica límite de peticiones. Ni MySQL ni el servidor de aplicación se publican directamente a internet.

Endpoints principales: `/health`, `/v1/network`, `/v1/centers`, `/v1/coordination`.

## Servicios

```bash
docker compose ps
docker compose logs --tail=100 api
docker compose up -d --build
```

## Despliegue continuo

Lo que entra a `main` se publica solo. Un timer de systemd consulta el repositorio cada minuto y, si hay algo nuevo, `scripts/deploy.sh` actualiza el código, corre las pruebas de la API, reconstruye los contenedores y comprueba que `/health` y la PWA respondan. Si algo falla, vuelve al commit anterior y lo reconstruye; el commit roto queda marcado para no reintentarlo en bucle, hasta que llegue un arreglo a `main` o se fuerce a mano.

El servidor también se usa para desarrollar, así que el despliegue se omite si el checkout está en otra rama o tiene cambios sin confirmar: nunca pisa trabajo en curso.

```bash
# instalación (una sola vez)
sudo install -m 644 deploy/quieroayudar-deploy.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now quieroayudar-deploy.timer

# operación
systemctl list-timers quieroayudar-deploy.timer     # cuándo corre la próxima vez
journalctl -u quieroayudar-deploy -f                # qué hizo el último despliegue
sudo ./scripts/deploy.sh --force                    # desplegar ahora, sin esperar
sudo systemctl disable --now quieroayudar-deploy.timer   # pausar el despliegue automático
```

Los valores por defecto (rama, URLs de salud, reintentos, si corren las pruebas) se ajustan en `/etc/default/quieroayudar-deploy`, fuera del repositorio.

## Respaldos

Los respaldos corren a diario por cron, se guardan con permisos privados y se retienen 14 días. El directorio de respaldos está fuera del repositorio.

```bash
sudo ./scripts/backup.sh
```

## Desarrollo y pruebas

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

## Configuración

Copiá `env.example` a `.env` y completá los valores. No se guardan secretos en Git: en producción el archivo se genera con `scripts/init_env.py` y permisos `600`.

## Datos

Los centros iniciales de Bogotá se importaron de un listado colaborativo público (agosto 2026) con `scripts/import_centers.py`. Cada centro conserva su fuente y su fecha de verificación.
