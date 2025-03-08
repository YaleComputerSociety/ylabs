import express from "express";
import passport from "passport";
import { Strategy } from "passport-cas";
import { validateUser } from './services/userService';
import { NotFoundError } from "./utils/errors";

passport.use(
  new Strategy(
    {
      version: "CAS2.0",
      ssoBaseURL: "https://secure.its.yale.edu/cas",
    },
    async function (profile, done) {
      console.log("verify user: ", profile);
      try {
        const user = await validateUser(profile.user);
        if (user) {
          done(null, {
            netId: profile.user,
            professor: user.isProfessor,
          });
        } else {
          done(null, false, { message: "User not found" });
        }
      } catch (error) {
        if (error instanceof NotFoundError) {
          done(null, false, { message: error.message });
        }
        done(error);
      }
    }
  )
);

passport.serializeUser(function (user: any, done) {
  done(null, user.netId);
});

passport.deserializeUser(async (netId, done) => {
  try {
    const user = await validateUser(netId);
    if (user) {
      done(null, {
        netId: user.netid,
        professor: user.isProfessor,
      });
    } else {
      done(new Error('User not found'), null);
    }
  } catch (error) {
    done(error, null);
  }
});

const casLogin = function (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  passport.authenticate("cas", function (err, user, info) {
    if (err) {
      return next(err);
    }
    //Handle prettier and add yalies here
    if (!user) {
      return res.status(401).json({ error: info.message || "CAS auth but no user" });
    }
    console.log("1::");
    console.log(user);

    req.logIn(user, function (err) {
      if (err) {
        return next(err);
      }

      if (req.query.redirect) {
        return res.redirect(req.query.redirect as string);
      }

      return res.redirect("/check");
    });
  })(req, res, next);
};

export default (app: express.Express) => {
  app.use(passport.initialize());
  app.use(passport.session());

  app.get("/check", (req, res) => {
    console.log("2::");
    console.log(req.user);
    if (req.user) {
      res.json({ auth: true, user: req.user });
    } else {
      res.json({ auth: false });
    }
  });

  app.get("/cas", casLogin);

  app.get("/logout", (req, res) => {
    req.logOut();
    return res.json({ success: true });
  });
};