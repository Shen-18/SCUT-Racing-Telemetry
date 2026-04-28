
// TestMatLabXRK.h : main header file for the PROJECT_NAME application
//

#pragma once

#ifndef __AFXWIN_H__
#error "include 'stdafx.h' before including this file for PCH"
#endif

#include "resource.h" // main symbols


// CTestMatLabXRKApp:
// See TestMatLabXRK.cpp for the implementation of this class
//

class CTestMatLabXRKApp : public CWinApp
{
#if (defined(_MSC_VER)) && (_MSC_VER >= 1910)
    CTestMatLabXRKApp & operator= (const CTestMatLabXRKApp & other) = delete;
    CTestMatLabXRKApp(const CTestMatLabXRKApp & other) = delete;
#endif

public:
    CTestMatLabXRKApp();

    // Overrides
public:
    virtual BOOL InitInstance();

    // Implementation

    DECLARE_MESSAGE_MAP()
};

extern CTestMatLabXRKApp theApp;