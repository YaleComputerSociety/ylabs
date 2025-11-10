import cors from "cors";
import express from "express";
import { isCI, isDevelopment, isTest } from "./utils/environment";
import passport, { passportRoutes } from "./passport";
import routes from "./routes";
import cookieSession from "cookie-session";
import dotenv from "dotenv";
import * as path from 'path';

dotenv.config();

const bypassCors = isCI() || isDevelopment() || isTest();
const allowList = new Set(["http://localhost:3000", "https://rdb.onrender.com", "https://ylabs-dev.onrender.com", "https://yalelabs.io"]);

const corsOptions = {
  origin: (origin: string, callback: any) => {
    if (origin === undefined || bypassCors || allowList.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
};

const app = express()
.use(cors(corsOptions))
.use(express.json())
.use(express.urlencoded({ extended: true }))
.use((req, res, next) => {
  cookieSession({
    name: "session",
    keys: [process.env.SESSION_SECRET],
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    httpOnly: true,
  })(req, res, next);
})
.use(passport.initialize())
.use(passport.session())
.use(passportRoutes)
.use(routes);

// Serve static files from the React app AFTER all API routes
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Catch-all handler: for any request that doesn't match an API route,
// send back the React app's index.html file
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

export default app;

// --- IGNORE ---