#!/usr/bin/env bash
# Runs a command detached under a watchdog that protects a shared machine.
# Usage: scripts/guarded_run.sh LOGDIR -- command [args...]
# Limits (env, MB / minutes): RSS_SOFT_MB RSS_HARD_MB FREE_SOFT_MB FREE_HARD_MB HEARTBEAT_MIN MAX_HOURS PAUSE_KILL_MIN POLL_S (HEARTBEAT_S and PAUSE_KILL_S override in seconds)
# Soft limit: the job group is paused (SIGSTOP) and a warning with the exact kill command is written.
# Hard limit, time limit, no output for HEARTBEAT_MIN, or a pause longer than PAUSE_KILL_MIN: the job group is killed.
# Only the process group created here is ever signalled.
set -u

LOGDIR="${1:?usage: guarded_run.sh LOGDIR -- command [args...]}"; shift
[ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "no command given" >&2; exit 2; }

RSS_SOFT_MB="${RSS_SOFT_MB:-5500}"
RSS_HARD_MB="${RSS_HARD_MB:-7500}"
FREE_SOFT_MB="${FREE_SOFT_MB:-4000}"
FREE_HARD_MB="${FREE_HARD_MB:-2500}"
HEARTBEAT_MIN="${HEARTBEAT_MIN:-45}"
MAX_HOURS="${MAX_HOURS:-6}"
PAUSE_KILL_MIN="${PAUSE_KILL_MIN:-10}"
POLL_S="${POLL_S:-5}"
START_FREE_MIN_MB="${START_FREE_MIN_MB:-8000}"
HEARTBEAT_S="${HEARTBEAT_S:-$((HEARTBEAT_MIN * 60))}"
PAUSE_KILL_S="${PAUSE_KILL_S:-$((PAUSE_KILL_MIN * 60))}"

mkdir -p "$LOGDIR"
JOBLOG="$LOGDIR/job.log"
WDLOG="$LOGDIR/watchdog.log"

free_mb() {
  if [ -r /proc/meminfo ]; then
    awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo
  else
    local ps; ps=$(sysctl -n hw.pagesize)
    vm_stat | awk -v ps="$ps" '/Pages (free|inactive|speculative)/{gsub("\\.","",$NF); s+=$NF} END{print int(s*ps/1048576)}'
  fi
}

group_rss_mb() {
  ps -eo pgid=,rss= | awk -v g="$1" '$1==g{s+=$2} END{print int(s/1024)}'
}

log() { echo "[$(date '+%F %T')] $*" | tee -a "$WDLOG"; }

if [ "$(free_mb)" -lt "$START_FREE_MIN_MB" ]; then
  echo "ABORT: only $(free_mb) MB free, need $START_FREE_MIN_MB MB. Nothing started." | tee -a "$WDLOG"
  exit 3
fi

: > "$JOBLOG"
perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' nice -n 10 "$@" >> "$JOBLOG" 2>&1 < /dev/null &
JOB=$!
log "STARTED job group $JOB: $* (soft ${RSS_SOFT_MB}MB, hard ${RSS_HARD_MB}MB, free soft ${FREE_SOFT_MB}MB, hard ${FREE_HARD_MB}MB, heartbeat ${HEARTBEAT_MIN}min, max ${MAX_HOURS}h)"

(
  start=$(date +%s); paused_at=0; state=run
  stop_job() {
    log "KILL ($1). Sending SIGTERM to group $JOB, then SIGKILL after 15s."
    kill -TERM -- "-$JOB" 2>/dev/null; kill -CONT -- "-$JOB" 2>/dev/null; sleep 15
    kill -KILL -- "-$JOB" 2>/dev/null
    log "KILLED group $JOB. Reason: $1"
  }
  while kill -0 "$JOB" 2>/dev/null || [ "$(group_rss_mb "$JOB")" -gt 0 ]; do
    now=$(date +%s); rss=$(group_rss_mb "$JOB"); free=$(free_mb)
    [ $((now - start)) -gt $((MAX_HOURS * 3600)) ] && { stop_job "time limit ${MAX_HOURS}h"; break; }
    [ "$rss" -gt "$RSS_HARD_MB" ] && { stop_job "job memory ${rss}MB > hard ${RSS_HARD_MB}MB"; break; }
    [ "$free" -lt "$FREE_HARD_MB" ] && { stop_job "machine free memory ${free}MB < hard ${FREE_HARD_MB}MB"; break; }
    last=$(stat -c %Y "$JOBLOG" 2>/dev/null || stat -f %m "$JOBLOG")
    [ "$state" = run ] && [ $((now - last)) -gt $HEARTBEAT_S ] && { stop_job "no output for ${HEARTBEAT_S}s (hung)"; break; }
    if [ "$state" = run ] && { [ "$rss" -gt "$RSS_SOFT_MB" ] || [ "$free" -lt "$FREE_SOFT_MB" ]; }; then
      kill -STOP -- "-$JOB" 2>/dev/null; state=paused; paused_at=$now
      log "WARNING: job PAUSED (job ${rss}MB, machine free ${free}MB). To kill it: kill -TERM -- -$JOB   To resume: kill -CONT -- -$JOB   Auto-kill in ${PAUSE_KILL_S}s."
    elif [ "$state" = paused ]; then
      if [ "$free" -gt $((FREE_SOFT_MB + 1500)) ] && [ "$rss" -lt "$RSS_SOFT_MB" ]; then
        kill -CONT -- "-$JOB" 2>/dev/null; state=run; touch "$JOBLOG"; log "RESUMED (job ${rss}MB, free ${free}MB)"
      elif [ $((now - paused_at)) -gt $PAUSE_KILL_S ]; then
        stop_job "paused more than ${PAUSE_KILL_S}s with no recovery"; break
      fi
    fi
    sleep "$POLL_S"
  done
  log "DONE watching group $JOB"
) > /dev/null 2>&1 &
disown

echo "Job group: $JOB"
echo "Follow:  tail -f $WDLOG   (job output: $JOBLOG)"
echo "Manual kill (only our job): kill -TERM -- -$JOB"
