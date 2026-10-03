import { afterEach } from 'bun:test';
import { runCleanups } from './cleanup.js';

afterEach(runCleanups);
