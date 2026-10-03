import { afterEach } from 'bun:test';
import { runCleanups } from './cleanup';

afterEach(runCleanups);
