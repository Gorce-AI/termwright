{
  "targets": [
    {
      "target_name": "termwright_conpty",
      "sources": ["src/binding.cc", "src/session.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include_dir\")"],
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
