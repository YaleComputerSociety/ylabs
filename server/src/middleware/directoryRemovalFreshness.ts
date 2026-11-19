import type { NextFunction, Request, Response } from 'express';
import {
  currentDirectoryRemovalServing,
  freshDirectoryRemovalServing,
  redactWithheldNamesDeep,
} from '../services/directoryRemovalServing';

export async function refreshDirectoryRemovalsBeforeServing(
  _req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  await freshDirectoryRemovalServing();
  next();
}

export function redactWithheldNamesInJson(_req: Request, res: Response, next: NextFunction): void {
  const json = res.json.bind(res);
  res.json = (body?: unknown) =>
    json(redactWithheldNamesDeep(body, currentDirectoryRemovalServing()));
  next();
}
