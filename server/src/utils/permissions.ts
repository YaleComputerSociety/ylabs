import express from "express";

const isAuthenticated = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.user) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

const isProfessor = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = req.user as { netId? : string, professor? : boolean};
    
    if (user && user.professor) {
        return next();
    }
    res.status(403).json({ error: "Forbidden" });
}
export { isAuthenticated, isProfessor };