/**
 * Report actions: print and export.
 *
 * Both are entirely client-side. Print hands off to the browser's own dialog
 * (`window.print()`), with `@media print` in index.css deciding what appears on
 * paper. Export builds the file in memory — see `lib/exportTrip.ts`.
 *
 * The whole row is `no-print`: a printed report should not show its own toolbar.
 */
import { Download, FileJson, Printer } from 'lucide-react';
import type { ExportInput } from '../lib/exportTrip';
import { exportTimelineCsv, exportTripJson } from '../lib/exportTrip';
import { Button } from './ui/Button';

interface TripActionsProps extends ExportInput {
  /** Disable export when there is nothing to export. */
  exportable?: boolean;
}

export function TripActions({ trip, timeline, route, exportable = true }: TripActionsProps) {
  const input: ExportInput = { trip, timeline, route };

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        onClick={() => window.print()}
        title="Print this trip as a report"
      >
        <Printer aria-hidden="true" className="h-4 w-4" />
        Print
      </Button>
      <Button
        variant="secondary"
        disabled={!exportable}
        onClick={() => exportTripJson(input)}
        title="Download the full trip record as JSON"
      >
        <FileJson aria-hidden="true" className="h-4 w-4" />
        Export JSON
      </Button>
      <Button
        variant="secondary"
        disabled={!exportable || timeline.length === 0}
        onClick={() => exportTimelineCsv(input)}
        title={
          timeline.length === 0
            ? 'No timeline to export'
            : 'Download the timeline as CSV for a spreadsheet'
        }
      >
        <Download aria-hidden="true" className="h-4 w-4" />
        Export CSV
      </Button>
    </div>
  );
}
