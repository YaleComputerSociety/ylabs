import express from "express";

const isAuthenticated = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.user) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

const isTrustworthy = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = req.user as { netId? : string, userType? : string, userConfirmed? : boolean};
    
    if (user && user.userConfirmed && (user.userType === "admin" || user.userType === "professor" || user.userType === "faculty")) {
        return next();
    }
    res.status(403).json({ error: "Forbidden" });
}

const isAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = req.user as { netId? : string, userType? : string, userConfirmed? : boolean};
    
    if (user && user.userType === "admin") {
        return next();
    }
    res.status(403).json({ error: "Forbidden - Admin access required" });
}

export { isAuthenticated, isTrustworthy, isAdmin };