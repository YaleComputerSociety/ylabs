import express from "express";

/**
 * Middleware to check if user is authenticated
 */
export const isAuthenticated = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.user) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
};

/**
 * Middleware to check if user is trustworthy (confirmed admin/professor/faculty)
 */
export const isTrustworthy = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = req.user as { netId?: string, userType?: string, userConfirmed?: boolean };
  
  if (user && user.userConfirmed && (user.userType === "admin" || user.userType === "professor" || user.userType === "faculty")) {
    return next();
  }
  res.status(403).json({ error: "Forbidden" });
};

/**
 * Middleware to check if user has permission to create listings
 */
export const canCreateListing = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const currentUser = req.user as { netId?: string, userType?: string, userConfirmed?: boolean };
  
  if (!currentUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const allowedTypes = ['admin', 'professor', 'faculty'];
  if (!allowedTypes.includes(currentUser.userType)) {
    return res.status(403).json({ error: 'User does not have permission to create listings' });
  }
  
  next();
};

/**
 * Middleware to check if user is an admin
 */
export const isAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const currentUser = req.user as { netId?: string, userType?: string, userConfirmed?: boolean };
  
  if (!currentUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (currentUser.userType !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  
  next();
};

/**
 * Middleware to check if user is a professor
 */
export const isProfessor = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const currentUser = req.user as { netId?: string, userType?: string, userConfirmed?: boolean };
  
  if (!currentUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (currentUser.userType !== 'professor' && currentUser.userType !== 'admin') {
    return res.status(403).json({ error: 'Professor privileges required' });
  }
  
  next();
};

/**
 * Middleware to check if user account is confirmed
 */
export const isConfirmed = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const currentUser = req.user as { netId?: string, userType?: string, userConfirmed?: boolean };
  
  if (!currentUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!currentUser.userConfirmed) {
    return res.status(403).json({ error: 'Account must be confirmed' });
  }
  
  next();
};