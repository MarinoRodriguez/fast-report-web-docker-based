#include <windows.h>

/*
 * DotNetBar in FastReport imports DwmIsCompositionEnabled with 0 arguments:
 *   [DllImport("dwmapi.dll")] public static extern bool DwmIsCompositionEnabled();
 * Standard Windows API expects 1 argument (BOOL *pfEnabled).
 * This stub provides the 0-argument signature returning FALSE (0),
 * safely disabling Aero Glass without corrupting the call stack on x86/x64 under Wine/QEMU.
 */

__declspec(dllexport) BOOL __stdcall DwmIsCompositionEnabled(void) {
    return FALSE;
}

__declspec(dllexport) HRESULT __stdcall DwmExtendFrameIntoClientArea(HWND hWnd, const void *pMargins) {
    return 0;
}

__declspec(dllexport) HRESULT __stdcall DwmSetWindowAttribute(HWND hwnd, DWORD dwAttribute, LPCVOID pvAttribute, DWORD cbAttribute) {
    return 0;
}

__declspec(dllexport) HRESULT __stdcall DwmGetWindowAttribute(HWND hwnd, DWORD dwAttribute, PVOID pvAttribute, DWORD cbAttribute) {
    return 0;
}

__declspec(dllexport) LRESULT __stdcall DwmDefWindowProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam, LRESULT *plResult) {
    return 0;
}

BOOL WINAPI DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved) {
    return TRUE;
}
