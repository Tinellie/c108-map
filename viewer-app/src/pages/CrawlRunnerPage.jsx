import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography
} from "@mui/material";

const CRAWL_OPTIONS_API = import.meta.env.VITE_CRAWL_OPTIONS_API_URL || "/api/crawl/options";
const CRAWL_JOBS_API = import.meta.env.VITE_CRAWL_JOBS_API_URL || "/api/crawl/jobs";

const FALLBACK_CRAWL_MODES = [
  {
    value: "full_list_new_detail",
    label: "Full list + new detail only",
    description: "Scrape all list pages but only crawl detail pages for circles not existing in DB before this run"
  },
  {
    value: "full_list_full_detail",
    label: "Full list + full detail",
    description: "Scrape all list pages and all detail pages; upsert existing circles and insert new ones"
  },
  {
    value: "new_list_new_detail",
    label: "New list + new detail only",
    description: "Write only circles not existing in DB before this run, then crawl detail pages only for those new circles"
  },
  {
    value: "list_only",
    label: "List only",
    description: "Scrape all list pages and upsert list fields only; skip all detail-page crawling"
  }
];

function statusColor(status) {
  if (status === "running") {
    return "warning";
  }

  if (status === "succeeded") {
    return "success";
  }

  if (status === "failed") {
    return "error";
  }

  return "default";
}

async function readJson(response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.message || `Request failed (${response.status})`);
  }
  return json;
}

export function CrawlRunnerPage() {
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [options, setOptions] = useState({ crawlModes: FALLBACK_CRAWL_MODES });

  const [crawlMode, setCrawlMode] = useState("full_list_new_detail");

  const [runningJob, setRunningJob] = useState(null);
  const [history, setHistory] = useState([]);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const crawlModeOptions = Array.isArray(options?.crawlModes) && options.crawlModes.length > 0
    ? options.crawlModes
    : FALLBACK_CRAWL_MODES;

  async function fetchOptions() {
    setLoadingOptions(true);
    setOptionsError("");

    try {
      const result = await fetch(CRAWL_OPTIONS_API);
      const json = await readJson(result);
      const nextOptions = json.data || null;
      setOptions(nextOptions);

      if (Array.isArray(nextOptions?.crawlModes) && nextOptions.crawlModes.length > 0) {
        const backendDefaultMode = String(nextOptions?.defaultCrawlMode || "").trim();
        const hasBackendDefault = nextOptions.crawlModes.some((item) => item.value === backendDefaultMode);
        const hasCurrentMode = nextOptions.crawlModes.some((item) => item.value === crawlMode);

        if (hasBackendDefault) {
          setCrawlMode(backendDefaultMode);
        } else if (!hasCurrentMode) {
          setCrawlMode(String(nextOptions.crawlModes[0].value || ""));
        }
      } else {
        setCrawlMode(FALLBACK_CRAWL_MODES[0].value);
      }
    } catch (error) {
      setOptionsError(error.message || "Failed to load crawl options");
      setOptions((current) => current || { crawlModes: FALLBACK_CRAWL_MODES });
      if (!crawlMode) {
        setCrawlMode(FALLBACK_CRAWL_MODES[0].value);
      }
    } finally {
      setLoadingOptions(false);
    }
  }

  async function refreshJobs() {
    try {
      const [currentRes, historyRes] = await Promise.all([
        fetch(`${CRAWL_JOBS_API}/current`),
        fetch(`${CRAWL_JOBS_API}?limit=10`)
      ]);

      const currentJson = await readJson(currentRes);
      const historyJson = await readJson(historyRes);

      setRunningJob(currentJson.data || null);
      setHistory(Array.isArray(historyJson.data) ? historyJson.data : []);
    } catch (error) {
      setActionError(error.message || "Failed to refresh job status");
    }
  }

  useEffect(() => {
    fetchOptions();
    refreshJobs();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshJobs();
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const canSubmit = useMemo(() => {
    return !submitting && !runningJob && crawlMode.trim().length > 0;
  }, [crawlMode, runningJob, submitting]);

  async function startJob() {
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setActionError("");
    setActionMessage("");

    try {
      const response = await fetch(CRAWL_JOBS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crawlMode
        })
      });

      const json = await readJson(response);
      setRunningJob(json.data || null);
      setActionMessage("Crawl job started. Status will refresh automatically.");
      await refreshJobs();
    } catch (error) {
      setActionError(error.message || "Failed to start crawl job");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", pb: 6 }}>
      <Container maxWidth="lg" sx={{ pt: 4 }}>
        <Paper elevation={0} sx={{ p: 3, border: "1px solid #eadbc7", borderRadius: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              Crawl Control Center
            </Typography>
            <Typography color="text.secondary">
              Use this page to trigger backend crawler jobs and monitor progress.
            </Typography>

            {loadingOptions ? <Alert severity="info">Loading crawl options...</Alert> : null}
            {optionsError ? <Alert severity="error">{optionsError}</Alert> : null}
            {actionError ? <Alert severity="error">{actionError}</Alert> : null}
            {actionMessage ? <Alert severity="success">{actionMessage}</Alert> : null}

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControl size="small" sx={{ minWidth: 320 }} disabled={loadingOptions}>
                <InputLabel id="crawl-mode-select-label">Crawl Mode</InputLabel>
                <Select
                  labelId="crawl-mode-select-label"
                  label="Crawl Mode"
                  value={crawlMode}
                  onChange={(event) => setCrawlMode(String(event.target.value || ""))}
                >
                  {crawlModeOptions.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="contained" onClick={startJob} disabled={!canSubmit}>
                {submitting ? "Starting..." : "Start Crawl"}
              </Button>
            </Stack>

            {runningJob ? (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <Typography variant="h6">Current Job</Typography>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Chip label={runningJob.status} color={statusColor(runningJob.status)} size="small" />
                    <Typography variant="body2" color="text.secondary">
                      ID: {runningJob.jobId}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Mode: {runningJob.request?.crawlMode}
                    </Typography>
                  </Stack>
                  <Typography variant="body2">URL: {runningJob.request?.url}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Started: {runningJob.startedAt}
                  </Typography>
                </Stack>
              </Paper>
            ) : (
              <Alert severity="info">No running crawl job.</Alert>
            )}

            <Typography variant="h6">Recent Jobs</Typography>
            <Stack spacing={1}>
              {history.length === 0 ? <Alert severity="info">No recent jobs.</Alert> : null}
              {history.map((job) => (
                <Paper key={job.jobId} variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={0.5}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Chip label={job.status} color={statusColor(job.status)} size="small" />
                      <Typography variant="body2" color="text.secondary">
                        ID: {job.jobId}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Duration: {job.durationMs || 0} ms
                      </Typography>
                    </Stack>
                    <Typography variant="body2">{job.request?.url}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Mode: {job.request?.crawlMode}
                    </Typography>
                    {job.summary ? (
                      <>
                        <Typography variant="body2" color="text.secondary">
                          Pages: {job.summary.pagesProcessed}, Circles: {job.summary.totalCircles}, New circles: {job.summary.totalNewCircles}, Written: {job.summary.totalCirclesWritten}, Detail targets: {job.summary.detailTargets}, Downloaded images: {job.summary.imagesDownloaded}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Changed items: {job.summary.changedCircles}, New items: {job.summary.newCirclesInserted}
                        </Typography>
                      </>
                    ) : null}
                    {job.error ? <Alert severity="error">{job.error}</Alert> : null}
                  </Stack>
                </Paper>
              ))}
            </Stack>

            <Typography variant="h6">Current Crawl Options</Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  Crawl mode:
                </Typography>
                {crawlModeOptions.map((mode) => (
                  <Typography key={mode.value} variant="body2">
                    {mode.label}: {mode.description}
                  </Typography>
                ))}
              </Stack>
            </Paper>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
