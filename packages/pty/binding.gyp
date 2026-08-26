{
  "targets": [
    {
      "target_name": "termwright_pty",
      "sources": [],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags_cc": ["-std=c++17"],
      "xcode_settings": {
        "MACOSX_DEPLOYMENT_TARGET": "13.5"
      },
      "conditions": [
        ["OS==\"win\"", {
          "sources": ["src/windows-binding.cc", "src/windows-conpty-api.cc", "src/windows-session.cc"],
          "defines": ["UNICODE", "_UNICODE"],
          "libraries": ["bcrypt.lib", "kernel32.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++17"]
            }
          }
        }, {
          "sources": ["src/binding.cc", "src/posix-session.cc"]
        }],
        ["OS==\"linux\"", { "libraries": ["-lutil"] }]
      ]
    }
  ]
}
