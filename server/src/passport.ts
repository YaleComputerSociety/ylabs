import express from "express";
import passport from "passport";
import { Strategy } from "passport-cas";
import { validateUser, createUser, readUser, userExists} from './services/userService';
import { fetchYalie } from "./services/yaliesService";
import { logEvent } from "./services/analyticsService";
import { AnalyticsEventType } from "./models";

passport.use(
  new Strategy(
    {
      version: "CAS1.0",
      ssoBaseURL: "https://secure.its.yale.edu/cas",
    },
    async function (profile, done) {
      console.log('User logged in from CAS');
      console.log("User profile: ", profile);

      try {
        console.log('Validating user');
        let user = await validateUser(profile.user);
        console.log('Done validating user');
        if (user) {
          console.log('User already exists');
          done(null, {
            netId: profile.user,
            userType: user.userType,
            userConfirmed: user.userConfirmed,
          });
        } else {
          console.log('User does not exist, fetching yalies');
          user = await fetchYalie(profile.user);
          console.log('Done fetching yalies');
          if (user) {
            console.log('Yalies fetch a success, sending user');
            done(null, {
              netId: user.netid,
              userType: user.userType,
              userConfirmed: user.userConfirmed,
            });
          } else {
            console.log('Yalies fetch no result, creating default user');
            user = await createUser(
              {
                netid: profile.user,
                fname: "NA",
                lname: "NA",
                email: "NA",
              }
            )
            console.log('Default user created, sending user');
            done(null, {
              netId:user.netid,
              userType: user.userType,
              userConfirmed: user.userConfirmed,
            });
          }
        }
      } catch (error) {
        console.log('Error in CAS login');
        done(error);
      }
    }
  )
);

passport.serializeUser(function (user: any, done) {
  console.log('Serializing user');
  done(null, user.netId);
});

passport.deserializeUser(async (netId: String, done) => {
  try {
    console.log('Deserializing user');
    console.log('Deserialize: Validating user');
    let user = await validateUser(netId);
    console.log('Deserialize: Done validating user');
    if (user) {
      console.log('Deserialize: User already exists');
      done(null, {
        netId: user.netid,
        userType: user.userType,
        userConfirmed: user.userConfirmed,
      });
    } else {
      console.log('Deserialize: User does not exist, fetching yalies');
      user = await fetchYalie(netId);
      console.log('Deserialize: Done fetching yalies');
      if (user) {
        console.log('Deserialize: Yalies fetch a success, sending user');
        done(null, {
          netId: user.netid,
          userType: user.userType,
          userConfirmed: user.userConfirmed,
        });
      } else {
        console.log('Deserialize: Yalies fetch no result, creating default user');
        user = await createUser(
          {
            netid: netId,
            fname: "NA",
            lname: "NA",
            email: "NA",
          }
        )
        console.log('Deserialize: Default user created, sending user');
        done(null, {
          netId: user.netid,
          userType: user.userType,
          userConfirmed: user.userConfirmed,
        });
      }
    }
  } catch (error) {
    console.log('Deserialize: Error in CAS login');
    done(error, null);
  }
});

const casLogin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  passport.authenticate("cas", async function (err: any, user: any, info: any) {
    if (err) {
      console.log("Error during CAS authentication");
      console.error("Error details:", err);
      
      try {
        console.error("Serialized error:", {
          message: err.messsage,
          stack: err.stack,
          name: err.name,
          fullError: JSON.stringify(err, Object.getOwnPropertyNames(err))
        });
      } catch (e) {
        console.error("Error serializing error object: ", e);
      }
      
      if (req.query && req.query.error) {
        return res.redirect(req.query.error as string);
      }

      return res.status(401).json({ error: "Error in authentication" });
    }

    if (!user) {
      console.log("CAS auth but no user");
      return res.status(401).json({ error: info.message || "CAS auth but no user" });
    }

    console.log("1::");
    console.log(user);

    console.log("Logging in user: ", user);
    req.logIn(user, async function (err) {
      console.log("Post login");
      if (err) {
        console.log("Error logging in");
        return next(err);
      }

      // Log login event to analytics
      try {
        await logEvent({
          eventType: AnalyticsEventType.LOGIN,
          netid: user.netid,
          userType: user.userType || 'unknown',
          metadata: {
            timestamp: new Date()
          }
        });
      } catch (analyticsError) {
        console.error("Error logging analytics event:", analyticsError);
        // Don't fail the login if analytics fails
      }

      if (req.query.redirect) {
        // Try to parse the URL to make sure it's valid
        try {
          const redirectUrl = new URL(req.query.redirect as string);
          
          return res.redirect(req.query.redirect as string);
        } catch (error) {
          console.error("Error parsing redirect URL:", error);
          console.log("Falling back to default redirect");
          return res.redirect("/check");
        }
      }

      console.log("Default redirecting user");
      return res.redirect("/check");
    });
  })(req, res, next);
};

const router = express.Router();

router.get("/check", (req, res) => {
  console.log("Checking user");
  console.log("2::");
  console.log(req.user);
  if (req.user) {
    res.json({ auth: true, user: req.user });
  } else {
    res.json({ auth: false });
  }
});

router.get("/cas", casLogin);

router.get("/logout", async (req, res) => {
  console.log("Logging out user");
  
  // Log logout event to analytics
  if (req.user) {
    const user = req.user as any;
    try {
      await logEvent({
        eventType: AnalyticsEventType.LOGOUT,
        netid: user.netid,
        userType: user.userType || 'unknown',
        metadata: {
          timestamp: new Date()
        }
      });
    } catch (analyticsError) {
      console.error("Error logging analytics event:", analyticsError);
      // Don't fail the logout if analytics fails
    }
  }
  
  req.logOut();
  return res.json({ success: true });
});

export { router as passportRoutes };
export default passport;