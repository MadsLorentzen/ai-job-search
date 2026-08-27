import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ROOT_DIR, DATA_DIR, ensureDir } from '../config/env.js';

const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');
const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');

ensureDir(DATA_DIR);

export const APPLICATION_STATUSES = Object.freeze([
  'Drafted', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn'
]);

/**
 * Fields a client may set on an application record.
 *
 * Explicitly excludes cvPdfPath / coverPdfPath: those are filesystem paths and
 * are only ever written by the server. Accepting them from the request body
 * previously let a caller point a record at any file on disk and then stream
 * it back through the download route.
 */
const CLIENT_WRITABLE_FIELDS = Object.freeze([
  'id', 'jobTitle', 'company', 'location', 'jobUrl', 'status', 'fitScore',
  'cvLatex', 'coverLetterLatex', 'auditsPassed', 'revisionsApplied',
  'reviewScore', 'notes', 'appliedAt', 'source'
]);

const SERVER_ONLY_FIELDS = Object.freeze(['cvPdfPath', 'coverPdfPath', 'createdAt', 'updatedAt']);

const DEFAULT_PROFILE = {
  identity: {
    name: '',
    title: '',
    email: '',
    phone: '',
    location: '',
    linkedin: '',
    github: '',
    portfolio: '',
    summary: '',
    status: 'Actively Looking',
    languages: []
  },
  education: [],
  experience: [],
  skills: { primary: [], secondary: [], domain: [], tools: [] },
  starStories: [],
  targetQueries: [],
  salary: { minimum: '', target: '', currency: '' }
};

/** Deep copy so callers cannot mutate the shared default in place. */
function cloneDefaultProfile() {
  return structuredClone(DEFAULT_PROFILE);
}

/**
 * Write via temp file + rename so a crash mid-write cannot leave truncated
 * JSON behind. rename is atomic within a filesystem.
 */
function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return { ok: true, value: fallback, missing: true };
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
  } catch (err) {
    // Distinguish "not there yet" from "there but unreadable". The second case
    // must not be silently overwritten with an empty list.
    return { ok: false, error: err };
  }
}

/**
 * Serialize every mutation through one promise chain.
 *
 * Each save used to read the whole file, edit in memory and write it back with
 * no coordination, so two overlapping requests would interleave and the later
 * write would erase the earlier one.
 */
let writeChain = Promise.resolve();
function serialize(fn) {
  const result = writeChain.then(fn, fn);
  writeChain = result.then(() => undefined, () => undefined);
  return result;
}

export const storageService = {
  getProfile() {
    const { ok, value, missing, error } = readJson(PROFILE_FILE, null);
    if (!ok) {
      console.error('Profile file is unreadable, serving defaults:', error.message);
      return cloneDefaultProfile();
    }
    if (missing) {
      const fresh = cloneDefaultProfile();
      writeJsonAtomic(PROFILE_FILE, fresh);
      return fresh;
    }
    return value;
  },

  saveProfile(profileData) {
    return serialize(async () => {
      if (!profileData || typeof profileData !== 'object' || Array.isArray(profileData)) {
        const err = new Error('Profile must be an object.');
        err.statusCode = 400;
        throw err;
      }
      writeJsonAtomic(PROFILE_FILE, profileData);
      return profileData;
    });
  },

  getApplications() {
    const { ok, value, missing, error } = readJson(APPLICATIONS_FILE, []);
    if (!ok) {
      console.error('Applications file is unreadable:', error.message);
      const err = new Error('Application store is corrupt. Not overwriting it; inspect server/data/applications.json.');
      err.statusCode = 500;
      throw err;
    }
    if (missing) return [];
    return Array.isArray(value) ? value : [];
  },

  /** Strip anything a client is not allowed to set. */
  sanitizeApplicationInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      const err = new Error('Application must be an object.');
      err.statusCode = 400;
      throw err;
    }
    const clean = {};
    for (const field of CLIENT_WRITABLE_FIELDS) {
      if (input[field] !== undefined) clean[field] = input[field];
    }
    if (clean.status !== undefined && !APPLICATION_STATUSES.includes(clean.status)) {
      const err = new Error(`Unknown status "${clean.status}". Expected one of: ${APPLICATION_STATUSES.join(', ')}.`);
      err.statusCode = 400;
      throw err;
    }
    if (!clean.id || typeof clean.id !== 'string') {
      const err = new Error('Application id is required.');
      err.statusCode = 400;
      throw err;
    }
    return clean;
  },

  /**
   * @param {object} application     client-supplied fields (already sanitized)
   * @param {object} serverFields    server-owned fields such as PDF paths
   */
  saveApplication(application, serverFields = {}) {
    return serialize(async () => {
      const apps = this.getApplications();
      const now = new Date().toISOString();

      const trusted = {};
      for (const field of SERVER_ONLY_FIELDS) {
        if (serverFields[field] !== undefined) trusted[field] = serverFields[field];
      }

      const index = apps.findIndex(a => a.id === application.id);
      let record;
      if (index >= 0) {
        record = { ...apps[index], ...application, ...trusted, updatedAt: now };
        apps[index] = record;
      } else {
        record = { ...application, ...trusted, createdAt: now, updatedAt: now };
        apps.unshift(record);
      }

      writeJsonAtomic(APPLICATIONS_FILE, apps);
      return record;
    });
  },

  deleteApplication(id) {
    return serialize(async () => {
      const apps = this.getApplications();
      const remaining = apps.filter(a => a.id !== id);
      writeJsonAtomic(APPLICATIONS_FILE, remaining);
      return { success: true, deleted: apps.length - remaining.length };
    });
  },

  getRootDir() {
    return ROOT_DIR;
  }
};
