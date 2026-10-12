import { AppPlugin } from '@grafana/data';

import { TraceExplorer } from './pages/TraceExplorer';

export const plugin = new AppPlugin().setRootPage(TraceExplorer);
