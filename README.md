# RoomSync

RoomSync is a responsive roommate expense manager with a Node.js/Express REST API, MySQL persistence, and JWT-authenticated accounts. The existing frontend design and modules remain in place. New room data is created only from user input; `database.sql` creates the schema and inserts no room, member, or transaction data.

## Requirements

- Node.js 20 or newer
- MySQL 8.0 or newer
- npm

## Install

1. In MySQL, initialize the empty database and tables:

   ```sql
   SOURCE C:/path/to/room calculation/database.sql;
   CREATE USER IF NOT EXISTS 'roomsync_user'@'127.0.0.1' IDENTIFIED BY 'use-a-strong-password';
   CREATE USER IF NOT EXISTS 'roomsync_user'@'localhost' IDENTIFIED BY 'use-a-strong-password';
   GRANT SELECT, INSERT, UPDATE, DELETE ON roomsync_db.* TO 'roomsync_user'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE, DELETE ON roomsync_db.* TO 'roomsync_user'@'localhost';
   FLUSH PRIVILEGES;
   ```

   Run `SOURCE` from the MySQL command-line client; substitute the Windows path to this project. The SQL script creates `roomsync_db` and all tables without inserting demo records. Create and grant the account matching the host in `DB_HOST`; the two entries above support both `127.0.0.1` and `localhost`.

2. From the project folder, install dependencies and create your local environment file:

   ```powershell
   npm install
   Copy-Item .env.example .env
   ```

3. Edit `.env` and set your MySQL connection values. Use the same MySQL password set for `roomsync_user`. Replace `JWT_SECRET` with a private random secret of at least 32 characters. Do not share or commit `.env`.

4. Start the website and API:

   ```powershell
   npm start
   ```

5. Open `http://localhost:3000`. If you use a local frontend server (such as Live Server), the frontend automatically calls the backend at `http://localhost:3000/api`; local development origins are allowed while `NODE_ENV` is not `production`.

For a deployed frontend hosted separately from the API, set `FRONTEND_ORIGINS` in `.env` to a comma-separated list of exact frontend origins (including scheme and port), and set the `roomsync-api-base` meta tag in `index.html` to the backend API base URL, such as `https://api.example.com/api`. Do not use `*` for production origins.

## Deploy the full stack for free

GitHub Pages hosts the static frontend; Render runs the Node.js API on its free web-service plan; TiDB Cloud Serverless provides a MySQL-compatible free-tier database. Free services may sleep when idle and cold-start slowly. The Pages site needs a reachable deployed API and database for registration, login, and workspace storage.

1. Push this project to a GitHub repository using the `main` branch. Keep `.env` out of Git.
2. Create a TiDB Cloud Serverless cluster. Create the `roomsync_db` database and initialize it with `database.sql`. Use the cluster's TLS connection details; the Render Blueprint uses port `4000` and TLS.
3. In Render, create a Blueprint from the repository using `render.yaml`. Set `DB_HOST`, `DB_USER`, and `DB_PASSWORD` from TiDB Cloud in Render's environment settings. Do not put database credentials in GitHub or this repository. Render generates `JWT_SECRET`; keep `NODE_ENV=production` and set `FRONTEND_ORIGINS` to the GitHub Pages origin, such as `https://<owner>.github.io` (no repository path).
4. In GitHub repository **Settings → Pages**, select **GitHub Actions** as the source. Add the repository variable `ROOMSYNC_API_BASE` with the full Render API URL ending in `/api`, for example `https://roomsync-api.onrender.com/api`.
5. Push to `main` or run **Deploy RoomSync to GitHub Pages** from the **Actions** tab. The Pages workflow publishes only the three frontend files and injects the API URL into the built `index.html`.

The GitHub Pages deployment summary shows the public website URL. Never commit `.env` or database credentials.

## Run and validate

- `npm run dev` restarts the server when backend files change.
- `npm run check` checks the frontend and server JavaScript syntax.
- `GET /api/health` reports whether MySQL is reachable.
- If account registration returns a MySQL availability/configuration error, start MySQL, initialize the schema from `database.sql`, and verify the `DB_*` values in `.env`.

The server serves `index.html`, `style.css`, `script.js`, and uploaded images from the same origin. Bootstrap, Chart.js, fonts, and icons continue to load from their existing public CDNs.

## API overview

All endpoints other than registration, login, and health require `Authorization: Bearer <token>`.

- `POST /api/auth/register` — `{ "name", "email", "password" }`
- `POST /api/auth/login` — `{ "email", "password" }`
- `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST /api/rooms`, `GET /api/rooms/:roomId`, `PUT /api/rooms`
- `POST /api/rooms/:roomId/invitations` — link an existing account to a manually added roommate (room owner only), body `{ "memberId", "email" }`
- `GET/PUT /api/workspace` — load/save the complete frontend workspace
- `GET/PUT /api/rent`, `GET /api/balances`
- `GET /api/reports/monthly?month=YYYY-MM`
- `POST /api/uploads/images` — multipart form fields `roomId` and one or more `images` (maximum five files per request; 2 MB per image)
- `GET/POST /api/{expenses,payments,shopping,inventory,notices,shoppingList,reminders,calendarEvents,locations,roommates}`
- `PUT/DELETE /api/{collection}/:id`

Each account can access its owned room and any room for which its account has been linked to a roommate record. Room resources and all related data are scoped to that access check. Uploaded images are stored in the project's `uploads/` folder; back up that folder along with MySQL if you need to retain image files.
