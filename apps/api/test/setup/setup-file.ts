import 'reflect-metadata';
import { applyTestEnv } from './test-env.js';

// Each worker needs the same environment the global setup prepared.
applyTestEnv();
