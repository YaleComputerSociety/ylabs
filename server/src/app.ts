import cors from "cors";
import express from "express";
import { isCI, isDevelopment, isTest } from "./utils/environment";
import passport from "./passport";
import routes from "./routes";
import cookieSession from "cookie-session";
import dotenv from "dotenv";
import * as path from 'path';

dotenv.config();

const bypassCors = isCI() || isDevelopment() || isTest();
const allowList = new Set(["http://localhost:3000", "https://rdb.onrender.com", "https://yalerdb.onrender.com", "https://yalelabs.io"]);

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
  .use(
    cookieSession({
      name: 'session',
      keys: [process.env.SESSION_SECRET],
      maxAge: 365 * 24 * 60 * 60 * 1000,//1 yr
      httpOnly: false,
      secure: true,
      sameSite: "none",
    })
  )
  .use(routes)
  .use('/', express.static('../client/build'));

app.get(['/login', '/about'], function(req, res) {
  res.sendFile(path.join(__dirname, '../../client/build/index.html'), function(err) {
    if (err) {
      res.status(500).send(err)
    }
  })
})

passport(app);

export default app;
