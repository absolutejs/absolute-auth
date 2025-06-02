import { treaty } from '@elysiajs/eden';
import { Server } from '../server';

export const server = treaty<Server>('http://localhost:3000');
