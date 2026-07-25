# Truck Trip Planner

Full-stack application for truck trip planning.

## Tech Stack

| Layer    | Technology                                            |
| -------- | ----------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4          |
| Backend  | Django 5, Django REST Framework, Python 3.12           |
| Database | PostgreSQL 16                                         |
| DevOps   | Docker, Docker Compose                                |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+)

For local development without Docker:

- Python 3.12+
- Node.js 20+
- PostgreSQL 16

## Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd webapp

# Start all services
docker compose up --build
```

Once running:

| Service  | URL                              |
| -------- | -------------------------------- |
| Frontend | http://localhost:3000             |
| Backend  | http://localhost:8000             |
| Health   | http://localhost:8000/api/health/ |

## Project Structure

```
webapp/
├── backend/                 # Django backend
│   ├── config/              # Project configuration
│   │   ├── settings/        # Split settings (base/development)
│   │   ├── urls.py          # Root URL routing
│   │   ├── wsgi.py          # WSGI entry point
│   │   └── asgi.py          # ASGI entry point
│   ├── apps/                # Django applications
│   │   └── core/            # Core app (health endpoint)
│   ├── manage.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                # React frontend
│   ├── src/                 # Source code
│   ├── public/              # Static assets
│   ├── vite.config.ts
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── .env                     # Environment variables (not committed)
├── .env.example             # Environment template
├── .gitignore
├── .editorconfig
└── README.md
```

## Local Development (Without Docker)

### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment variables
cp .env.example .env
# Edit .env — set POSTGRES_HOST=localhost

# Run migrations
python manage.py migrate

# Start development server
python manage.py runserver
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

## Available Commands

### Frontend

| Command              | Description                     |
| -------------------- | ------------------------------- |
| `npm run dev`        | Start Vite development server   |
| `npm run build`      | Build for production            |
| `npm run lint`       | Run ESLint                      |
| `npm run format`     | Format code with Prettier       |
| `npm run format:check` | Check formatting              |
| `npm run preview`    | Preview production build        |

### Backend

| Command                            | Description              |
| ---------------------------------- | ------------------------ |
| `python manage.py runserver`       | Start development server |
| `python manage.py migrate`         | Apply database migrations|
| `python manage.py createsuperuser` | Create admin user        |

## Environment Variables

See [.env.example](.env.example) for all required variables.

## Validation Checklist

- [ ] `docker compose up --build` starts all 3 services
- [ ] `GET http://localhost:8000/api/health/` returns `{"status": "ok"}`
- [ ] `http://localhost:3000` displays "Truck Trip Planner"
