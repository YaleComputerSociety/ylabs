/**
 * Passport.js configuration for Yale CAS authentication.
 */
import express from "express";
import passport from "passport";
import { Strategy } from "passport-cas";
import { validateUser, createUser, updateUser } from './services/userService';
import { fetchYalie } from "./services/yaliesService";
import { fetchFromDirectory, isFacultyTitle } from "./services/directoryService";
import { logEvent } from "./services/analyticsService";
import { AnalyticsEventType } from "./models/index";

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Build an update object from directory data (only non-empty fields).
 */
function buildDirectoryUpdate(dirPerson: NonNullable<Awaited<ReturnType<typeof fetchFromDirectory>>>) {
  const update: Record<string, any> = {};
  if (dirPerson.firstName) update.fname = dirPerson.firstName;
  if (dirPerson.lastName) update.lname = dirPerson.lastName;
  if (dirPerson.email) update.email = dirPerson.email;
  if (dirPerson.department) update.departments = [dirPerson.department];
  if (dirPerson.title) update.title = dirPerson.title;
  if (dirPerson.phone) update.phone = dirPerson.phone;
  if (dirPerson.upi) update.upi = dirPerson.upi;
  if (dirPerson.unit) update.unit = dirPerson.unit;
  if (dirPerson.physical_location) update.physical_location = dirPerson.physical_location;
  if (dirPerson.building_desk) update.building_desk = dirPerson.building_desk;
  if (dirPerson.mailing_address) update.mailing_address = dirPerson.mailing_address;
  return update;
}

/**
 * Shared helper: find or create a user by netid.
 * 1. Check if user already exists in DB (refresh from directory if stale)
 * 2. Try Yalies API (undergrad/grad detection)
 * 3. If Yalies fails, try Yale Directory (faculty detection)
 * 4. Fallback: create a default user
 */
async function findOrCreateUser(netid: string) {
  let user = await validateUser(netid);
  if (user) {
    const updatedAt = user.updatedAt ? new Date(user.updatedAt).getTime() : 0;
    const isStale = Date.now() - updatedAt > STALE_THRESHOLD_MS;

    if (isStale) {
      console.log(`findOrCreateUser: refreshing stale data for ${netid} (last updated: ${user.updatedAt || 'never'})`);
      try {
        const dirPerson = await fetchFromDirectory(netid, 'netid');
        if (dirPerson && dirPerson.name) {
          const dirUpdate = buildDirectoryUpdate(dirPerson);
          if (user.userType === 'unknown' && isFacultyTitle(dirPerson.title)) {
            dirUpdate.userType = 'professor';
            dirUpdate.userConfirmed = true;
          }
          user = await updateUser(netid, dirUpdate);
          console.log(`findOrCreateUser: refreshed directory data for ${netid}`);
        }
      } catch (err) {
        console.log(`findOrCreateUser: directory refresh failed for ${netid}, using cached data`);
      }
    } else {
      console.log(`findOrCreateUser: existing user ${netid} (fresh)`);
    }
    return user;
  }

  console.log(`findOrCreateUser: trying Yalies API for ${netid}`);
  user = await fetchYalie(netid);
  if (user) {
    console.log(`findOrCreateUser: Yalies success for ${netid}, type=${user.userType}`);
    return user;
  }

  console.log(`findOrCreateUser: Yalies failed, trying Yale Directory for ${netid}`);
  const dirPerson = await fetchFromDirectory(netid, 'netid');
  if (dirPerson && dirPerson.name) {
    console.log(`findOrCreateUser: Directory found ${dirPerson.name}, title="${dirPerson.title}"`);

    const userType = isFacultyTitle(dirPerson.title) ? 'professor' : 'unknown';
    const dirFields = buildDirectoryUpdate(dirPerson);
    user = await createUser({
      netid,
      fname: dirPerson.firstName || dirPerson.name.split(' ')[0] || 'NA',
      lname: dirPerson.lastName || dirPerson.name.split(' ').slice(1).join(' ') || 'NA',
      email: dirPerson.email || `${netid}@yale.edu`,
      departments: dirPerson.department ? [dirPerson.department] : [],
      userType,
      userConfirmed: userType === 'professor',
      ...dirFields,
    });
    console.log(`findOrCreateUser: Directory user created, type=${userType}`);
    return user;
  }

  console.log(`findOrCreateUser: Directory also failed, creating default user for ${netid}`);
  user = await createUser({
    netid,
    fname: "NA",
    lname: "NA",
    email: "NA",
  });
  return user;
}

passport.use(
  new Strategy(
    {
      version: "CAS1.0",
      ssoBaseURL: process.env.SSOBASEURL ?? '',
      serverBaseURL: process.env.SERVER_BASE_URL ?? '',
    },
    async function (profile, done) {
      console.log('User logged in from CAS');
      console.log("User profile: ", profile);

      try {
        const user = await findOrCreateUser(profile.user);
        done(null, {
          netId: user.netid || profile.user,
          userType: user.userType,
          userConfirmed: user.userConfirmed,
          profileVerified: user.profileVerified || false,
        });
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
    const user = await findOrCreateUser(netId as string);
    done(null, {
      netId: user.netid || netId,
      userType: user.userType,
      userConfirmed: user.userConfirmed,
      profileVerified: user.profileVerified || false,
    });
  } catch (error) {
    console.log('Deserialize: Error');
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
      console.log("Error in authenticate function")
      try {
        console.error("Authentication error details: ", {
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

      try {
        await logEvent({
          eventType: AnalyticsEventType.LOGIN,
          netid: user.netId,
          userType: user.userType || 'unknown',
          metadata: {
            timestamp: new Date(),
            loginMethod: 'CAS'
          }
        });
        console.log('Login event logged to analytics');
      } catch (analyticsError) {
        console.error("Error logging analytics event:", analyticsError);
      }

      if (req.query.redirect) {
        try {
          const redirectUrl = new URL(req.query.redirect as string);
          
          return res.redirect(req.query.redirect as string);
        } catch (error) {
          console.error("Error parsing redirect URL:", error);
          console.log("Falling back to default redirect");
          return res.redirect("/");
        }
      }

      console.log("Default redirecting user");
      const defaultRedirect = process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : '/';
      return res.redirect(defaultRedirect);
    });
  })(req, res, next);
};

const router = express.Router();

router.use(async (req, res, next) => {
  if (req.isAuthenticated() && !req.session!.visitorLogged) {
    const user = req.user as any;
    try {
      await logEvent({
        eventType: AnalyticsEventType.VISITOR,
        netid: user.netId,
        userType: user.userType || 'unknown',
        metadata: {
          timestamp: new Date(),
          loginMethod: 'cookie'
        }
      });
      console.log('🍪 Visitor event logged to analytics (cookie login)');
      req.session!.visitorLogged = true;
    } catch (analyticsError) {
      console.error("Error logging visitor analytics event:", analyticsError);
    }
  }
  next();
});

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
  
  if (req.user) {
    const user = req.user as any;
    try {
      await logEvent({
        eventType: AnalyticsEventType.LOGOUT,
        netid: user.netId,
        userType: user.userType || 'unknown',
        metadata: {
          timestamp: new Date()
        }
      });
      console.log('Logout event logged to analytics');
    } catch (analyticsError) {
      console.error("Error logging analytics event:", analyticsError);
    }
  }
  
  req.logOut();
  
  const casLogoutUrl = `${process.env.SSOBASEURL}/logout`;

  let serviceUrl;

  if (process.env.NODE_ENV === 'development') {
    serviceUrl = "http://localhost:3000/login";
  } else {
    serviceUrl = `${process.env.SERVER_BASE_URL}/login`;
  }

  const fullLogoutUrl = `${casLogoutUrl}?service=${encodeURIComponent(serviceUrl)}`;
  return res.redirect(fullLogoutUrl);
  
});

if (process.env.NODE_ENV === 'development') {
  router.get("/dev-login", async (req, res) => {
    const testUser = {
      netId: "test123",
      userType: "student",
      userConfirmed: true,
    };
    
    try {
      console.log('Dev login with hardcoded user:', testUser);
      
      req.logIn(testUser, async (err) => {
        if (err) {
          console.error("Dev login error:", err);
          return res.status(500).json({ error: err.message });
        }

        try {
          await logEvent({
            eventType: AnalyticsEventType.LOGIN,
            netid: testUser.netId,
            userType: testUser.userType || 'unknown',
            metadata: {
              timestamp: new Date(),
              loginMethod: 'dev-login'
            }
          });
          console.log('Dev login event logged to analytics');
        } catch (analyticsError) {
          console.error("Error logging dev login analytics event:", analyticsError);
        }

        const redirectUrl = (req.query.redirect as string) || "http://localhost:3000";
        console.log('Redirecting to:', redirectUrl);
        res.redirect(redirectUrl);
      });
    } catch (error) {    
      console.error("Dev login error:", error);
      res.status(500).json({ error: "Dev login failed" });
    }
  });
}

export { router as passportRoutes };
export default passport;
