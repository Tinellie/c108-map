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
  LinearProgress,
  Paper,
  Select,
  Stack,
  Typography
} from "@mui/material";
import { withApiBaseUrl } from "../utils/apiBase.js";

const CRAWL_OPTIONS_API = withApiBaseUrl("/api/crawl/options");
const CRAWL_JOBS_API = withApiBaseUrl("/api/crawl/jobs");

const FALLBACK_CRAWL_MODES = [
  {
    value: "full_list_new_detail",
    label: "全量列表 + 新增详情",
    description: "抓取全部列表，仅抓取新增社团的详情"
  },
  {
    value: "full_list_full_detail",
    label: "全量列表 + 全量详情",
    description: "抓取全部列表和全部详情，覆盖更新"
  },
  {
    value: "new_list_new_detail",
    label: "新增列表 + 新增详情",
    description: "只写入新增社团，并抓取其详情"
  },
  {
    value: "list_only",
    label: "仅列表",
    description: "只抓取列表，不抓取详情"
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

function getDetailProgressValue(progress) {
  const total = Number(progress?.detailTotal || 0);
  const done = Number(progress?.detailDone || 0);

  if (!total || total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (done / total) * 100));
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
      setOptionsError(error.message || "加载抓取选项失败");
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
      setActionError(error.message || "刷新任务状态失败");
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
      setActionMessage("任务已启动");
      await refreshJobs();
    } catch (error) {
      setActionError(error.message || "启动任务失败");
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
              社团抓取
            </Typography>

            {loadingOptions ? <Alert severity="info">加载选项中...</Alert> : null}
            {optionsError ? <Alert severity="error">{optionsError}</Alert> : null}
            {actionError ? <Alert severity="error">{actionError}</Alert> : null}
            {actionMessage ? <Alert severity="success">{actionMessage}</Alert> : null}

            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControl size="small" sx={{ minWidth: 320 }} disabled={loadingOptions}>
                <InputLabel id="crawl-mode-select-label">抓取模式</InputLabel>
                <Select
                  labelId="crawl-mode-select-label"
                  label="抓取模式"
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
                {submitting ? "启动中..." : "开始抓取"}
              </Button>
            </Stack>

            {runningJob ? (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <Typography variant="h6">当前任务</Typography>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Chip label={runningJob.status} color={statusColor(runningJob.status)} size="small" />
                    <Typography variant="body2" color="text.secondary">
                      ID：{runningJob.jobId}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      模式：{runningJob.request?.crawlMode}
                    </Typography>
                  </Stack>
                  <Typography variant="body2">URL：{runningJob.request?.url}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    开始时间：{runningJob.startedAt}
                  </Typography>
                  {runningJob.progress ? (
                    <Stack spacing={1} sx={{ pt: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        原有: {runningJob.progress.originalCount}
                        {runningJob.progress.newCount > 0 ? `，新增: ${runningJob.progress.newCount}` : ""}
                      </Typography>
                      {runningJob.progress.stage === "detail" ? (
                        <Stack spacing={0.75}>
                          <LinearProgress variant="determinate" value={getDetailProgressValue(runningJob.progress)} />
                          <Typography variant="body2" color="text.secondary">
                            详情抓取：{runningJob.progress.detailDone}/{runningJob.progress.detailTotal}
                            {runningJob.progress.detailFailed ? `，失败 ${runningJob.progress.detailFailed}` : ""}
                          </Typography>
                        </Stack>
                      ) : null}
                      {runningJob.progress.message ? (
                        <Typography variant="body2" color="text.secondary">
                          {runningJob.progress.message}
                        </Typography>
                      ) : null}
                    </Stack>
                  ) : null}
                </Stack>
              </Paper>
            ) : (
              <Alert severity="info">当前没有运行任务</Alert>
            )}

            <Typography variant="h6">最近记录</Typography>
            <Stack spacing={1}>
              {history.length === 0 ? <Alert severity="info">暂无记录</Alert> : null}
              {history.map((job) => (
                <Paper key={job.jobId} variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={0.5}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Chip label={job.status} color={statusColor(job.status)} size="small" />
                      <Typography variant="body2" color="text.secondary">
                        ID：{job.jobId}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        耗时：{job.durationMs || 0} ms
                      </Typography>
                    </Stack>
                    <Typography variant="body2">{job.request?.url}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      模式：{job.request?.crawlMode}
                    </Typography>
                    {job.summary ? (
                      <>
                        <Typography variant="body2" color="text.secondary">
                          页数：{job.summary.pagesProcessed}，社团：{job.summary.totalCircles}，新增：{job.summary.totalNewCircles}，写入：{job.summary.totalCirclesWritten}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          变更：{job.summary.changedCircles}，新增写入：{job.summary.newCirclesInserted}，详情目标：{job.summary.detailTargets}，下载图片：{job.summary.imagesDownloaded}
                        </Typography>
                      </>
                    ) : null}
                    {job.error ? <Alert severity="error">{job.error}</Alert> : null}
                  </Stack>
                </Paper>
              ))}
            </Stack>

            <Typography variant="h6">模式</Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
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
