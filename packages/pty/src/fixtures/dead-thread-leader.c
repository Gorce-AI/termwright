#include <errno.h>
#include <pthread.h>
#include <unistd.h>

static pthread_t leader;

static void* worker(void* ignored) {
  (void)ignored;
  (void)pthread_join(leader, NULL);
  static const char ready[] = "DEAD_THREAD_LEADER_READY";
  (void)write(3, ready, sizeof(ready) - 1);
  char byte;
  while (read(STDIN_FILENO, &byte, 1) == -1 && errno == EINTR) {
  }
  return NULL;
}

int main(void) {
  leader = pthread_self();
  pthread_t thread;
  if (pthread_create(&thread, NULL, worker, NULL) != 0) return 2;
  pthread_exit(NULL);
}
