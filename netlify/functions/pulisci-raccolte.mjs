import {cleanup} from '../../server/cleanup.js';
export default async()=>Response.json(await cleanup());
export const config={schedule:'0 3 * * *'};
