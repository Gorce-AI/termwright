{
  "targets": [
    {
      "target_name": "termwright_conpty",
      "sources": ["src/binding.cc", "src/session.cc"],
      # `include`, not `include_dir`: the latter is relative to the cwd, and
      # gyp builds from packages/conpty/build, so the relative form resolves
      # two directories away from where the headers actually are. `include` is
      # absolute and already quoted for this exact expansion.
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "UNICODE", "_UNICODE"],
      "conditions": [
        [
          "OS==\"win\"",
          {
            "libraries": ["kernel32.lib"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": ["/std:c++17"]
              }
            }
          }
        ]
      ]
    }
  ]
}
