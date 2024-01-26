import cors from "cors";
import express from "express";
import { isCI, isDevelopment, isTest } from "./utils/environment";
import passport from "./passport";
import routes from "./routes";
import cookieSession from "cookie-session";

const bypassCors = isCI() || isDevelopment() || isTest();
const allowList = new Set(["http://localhost:3000", "http://rdb.onrender.com"]);

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
    /*session({
      secret: "this is totally secret",
      resave: false,
      saveUninitialized: false,
    })*/
    cookieSession({
      secret: "this is totally secret",
      maxAge: 365 * 24 * 60 * 60 * 1000,//1 yr
      httpOnly: false,
    })
  )
  .use(routes)
  .use('/', express.static('../client/build'));

passport(app);

export default app;
