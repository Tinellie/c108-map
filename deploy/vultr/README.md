Vultr Deployment Guide
======================

This guide deploys the project with:
- MySQL (container)
- API service (Node.js + Puppeteer + Python map extraction)
- Web service (Vite build served by Nginx)
- Caddy (HTTPS certificate + public reverse proxy)

Prerequisites
-------------

1. Vultr instance: Ubuntu 22.04 or 24.04.
2. Domain with A record pointing to the server public IP.
3. Firewall allows ports 22, 80, 443.
4. Repository code uploaded to server.

1) Install Docker and Compose plugin
------------------------------------

Run on the Vultr server:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and log in again, then verify:

```bash
docker --version
docker compose version
```

2) Prepare project files on server
----------------------------------

Example path:

```bash
mkdir -p /opt/c108
cd /opt/c108
# clone or upload your repository content here
```

3) Prepare deployment env files
-------------------------------

```bash
cd /opt/c108
test -f deploy/vultr/.env || cp deploy/vultr/.env.example deploy/vultr/.env
test -f deploy/vultr/api.env || cp deploy/vultr/api.env.example deploy/vultr/api.env
```

Edit both files:

```bash
nano deploy/vultr/.env
nano deploy/vultr/api.env
```

Required edits:
- Set DOMAIN and ACME_EMAIL in deploy/vultr/.env.
- Set strong MYSQL_* passwords in deploy/vultr/.env.
- Keep deploy/vultr/api.env database values consistent with deploy/vultr/.env.
- Set AUTH_SESSION_SECRET and AUTH_BOOTSTRAP_PASSWORD in deploy/vultr/api.env.
- Set API_CORS_ORIGIN and API_PUBLIC_BASE_URL to https://your-domain.

4) Start services
-----------------

```bash
cd /opt/c108/deploy/vultr
docker compose --env-file .env up -d --build
```

Check status:

```bash
docker compose ps
docker compose logs -f caddy
docker compose logs -f api
```

5) Verify deployment
--------------------

After DNS resolves and certificates are issued:

- Open https://your-domain
- Login with AUTH_BOOTSTRAP_USERNAME / AUTH_BOOTSTRAP_PASSWORD.

API checks:

```bash
curl -I https://your-domain
curl -I https://your-domain/api/health
```

6) Persistence and data notes
-----------------------------

- MySQL data: docker named volume db_data.
- App files: repository storage directory mounted to /app/storage in API container.
- If moving servers, back up both:
  - database volume
  - project storage directory

7) Update procedure
-------------------

```bash
cd /opt/c108
# pull latest code
cd deploy/vultr
docker compose --env-file .env up -d --build
```

8) Useful operations
--------------------

View logs:

```bash
cd /opt/c108/deploy/vultr
docker compose logs -f api
docker compose logs -f web
docker compose logs -f caddy
```

Restart one service:

```bash
docker compose restart api
```

Stop all:

```bash
docker compose down
```

If you need to recreate everything including database volume (dangerous):

```bash
docker compose down -v
```
