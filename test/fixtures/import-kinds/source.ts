import defaultExport from './target';
import { namedExport } from './target';
import * as everything from './target';

export const result = defaultExport + namedExport + everything.namedExport;
