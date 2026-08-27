#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef FILE* (*fopen_fn)(const char*, const char*);
typedef char* (*fgets_fn)(char*, int, FILE*);

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static FILE* read_failure_stream = NULL;

static int is_target_proc_stat(const char* path) {
  const char* marker = getenv("TERMWRIGHT_PROCSTAT_ESRCH_MARKER");
  if (marker == NULL) return 0;
  const int descriptor = open(marker, O_RDONLY | O_CLOEXEC);
  if (descriptor == -1) return 0;
  char target[32];
  const ssize_t length = read(descriptor, target, sizeof(target) - 1);
  close(descriptor);
  if (length <= 0 || (size_t)length >= sizeof(target)) return 0;
  target[length] = '\0';
  for (ssize_t index = 0; index < length; index += 1) {
    if (target[index] < '0' || target[index] > '9') return 0;
  }
  char expected[64];
  const int written = snprintf(expected, sizeof(expected), "/proc/%s/stat", target);
  return written > 0 && (size_t)written < sizeof(expected) && strcmp(path, expected) == 0;
}

static int claim_failure(const char* phase) {
  const char* configured = getenv("TERMWRIGHT_PROCSTAT_ESRCH_PHASE");
  const char* marker = getenv("TERMWRIGHT_PROCSTAT_ESRCH_MARKER");
  return configured != NULL && marker != NULL && strcmp(configured, phase) == 0 &&
         unlink(marker) == 0;
}

static FILE* open_with_interposer(const char* path, const char* mode,
                                  const char* symbol) {
  fopen_fn original = (fopen_fn)dlsym(RTLD_NEXT, symbol);
  if (is_target_proc_stat(path) && claim_failure("open")) {
    errno = ESRCH;
    return NULL;
  }
  FILE* stream = original(path, mode);
  if (stream != NULL && is_target_proc_stat(path) && claim_failure("read")) {
    pthread_mutex_lock(&lock);
    read_failure_stream = stream;
    pthread_mutex_unlock(&lock);
  }
  return stream;
}

FILE* fopen(const char* path, const char* mode) {
  return open_with_interposer(path, mode, "fopen");
}

FILE* fopen64(const char* path, const char* mode) {
  return open_with_interposer(path, mode, "fopen64");
}

char* fgets(char* buffer, int size, FILE* stream) {
  fgets_fn original = (fgets_fn)dlsym(RTLD_NEXT, "fgets");
  pthread_mutex_lock(&lock);
  const int fail = stream == read_failure_stream;
  if (fail) read_failure_stream = NULL;
  pthread_mutex_unlock(&lock);
  if (fail) {
    errno = ESRCH;
    return NULL;
  }
  return original(buffer, size, stream);
}
