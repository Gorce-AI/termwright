#define _GNU_SOURCE

#include <errno.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static int fail(pid_t child, int code) {
  kill(child, SIGKILL);
  while (waitpid(child, NULL, 0) == -1 && errno == EINTR) {
  }
  return code;
}

int main(int argc, char** argv) {
  if (argc < 2) return 64;

  int ready[2];
  if (pipe(ready) == -1) return 65;
  const pid_t blocked = fork();
  if (blocked == -1) return 66;
  if (blocked == 0) {
    close(ready[0]);
    const pid_t parent = getppid();
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) == -1) _exit(69);
    if (getppid() != parent) _exit(70);
    const char prepared = '1';
    if (write(ready[1], &prepared, 1) != 1) _exit(71);
    close(ready[1]);
    for (;;) pause();
  }
  close(ready[1]);
  char prepared = '\0';
  ssize_t count;
  do {
    count = read(ready[0], &prepared, 1);
  } while (count == -1 && errno == EINTR);
  close(ready[0]);
  if (count != 1 || prepared != '1') return fail(blocked, 67);

  char blocked_text[32];
  snprintf(blocked_text, sizeof(blocked_text), "%d", blocked);
  if (setenv("TERMWRIGHT_BLOCKED_PID", blocked_text, 1) == -1) {
    return fail(blocked, 68);
  }

  struct sock_filter instructions[] = {
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_pidfd_open, 0, 3),
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
               offsetof(struct seccomp_data, args[0])),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (unsigned int)blocked, 0, 1),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog filter = {
      .len = (unsigned short)(sizeof(instructions) / sizeof(instructions[0])),
      .filter = instructions,
  };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == -1 ||
      prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &filter) == -1) {
    return fail(blocked, 72);
  }

  execvp(argv[1], &argv[1]);
  return fail(blocked, 73);
}
