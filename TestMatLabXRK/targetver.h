#pragma once

// Including SDKDDKVer.h defines the highest available Windows platform.

// If you wish to build your application for a previous Windows platform, include WinSDKVer.h and
// set the _WIN32_WINNT macro to the platform you wish to support before including SDKDDKVer.h.

#ifdef _WIN64
#define NTDDI_VERSION NTDDI_WIN7
#define _WIN32_WINNT _WIN32_WINNT_WIN7
#else //_WIN64
#define NTDDI_VERSION NTDDI_WINXPSP3
#define _WIN32_WINNT _WIN32_WINNT_WINXP
#endif // _WIN64

#include <SDKDDKVer.h>
