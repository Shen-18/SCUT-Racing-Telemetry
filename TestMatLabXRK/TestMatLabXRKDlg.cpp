
#include "stdafx.h"
#include "TestMatLabXRKDlg.h"
#include "afxdialogex.h"
#include <string>
#include <sstream>
#include <fstream>
#include <list>
#include <vector>

#ifdef _DEBUG
#define new DEBUG_NEW
#endif

#pragma warning (push)
#if (defined(_MSC_VER)) && (_MSC_VER > 1932)
#pragma warning (disable: 5262)
#endif

class CAboutDlg : public CDialogEx
{
#if (defined(_MSC_VER)) && (_MSC_VER >= 1910)
    CAboutDlg & operator= (const CAboutDlg & other) = delete;
    CAboutDlg(const CAboutDlg & other) = delete;
#endif
public:
    CAboutDlg();

    enum { IDD = IDD_ABOUTBOX };

protected:
    virtual void DoDataExchange(CDataExchange* pDX);

protected:
    DECLARE_MESSAGE_MAP()
};

CAboutDlg::CAboutDlg() : CDialogEx(CAboutDlg::IDD)
{
}

void CAboutDlg::DoDataExchange(CDataExchange* pDX)
{
    CDialogEx::DoDataExchange(pDX);
}

BEGIN_MESSAGE_MAP(CAboutDlg, CDialogEx)
END_MESSAGE_MAP()


CTestMatLabXRKDlg::CTestMatLabXRKDlg(CWnd* pParent /*=NULL*/)
    : CDialogEx(CTestMatLabXRKDlg::IDD, pParent)
    , m_hdl(0)
    , m_idx(0)
    , m_p_func_get_library_date                     (NULL)
    , m_p_func_get_library_time                     (NULL)
    , m_p_func_open_file                            (NULL)
    , m_p_func_open_file_with_licence               (NULL)
    , m_p_func_close_file_n                         (NULL)
    , m_p_func_close_file_i                         (NULL)
    , m_p_func_get_vehicle_name                     (NULL)
    , m_p_func_get_track_name                       (NULL)
    , m_p_func_get_racer_name                       (NULL)
    , m_p_func_get_championship_name                (NULL)
    , m_p_func_get_session_type_name                (NULL)
    , m_p_func_get_date_and_time                    (NULL)
    , m_p_func_get_laps_count                       (NULL)
    , m_p_func_get_lap_info                         (NULL)
    , m_p_func_get_channels_count                   (NULL)
    , m_p_func_get_channel_name                     (NULL)
    , m_p_func_get_channel_units                    (NULL)
    , m_p_func_get_channel_samples_count            (NULL)
    , m_p_func_get_channel_samples                  (NULL)
    , m_p_func_get_lap_channel_samples_count        (NULL)
    , m_p_func_get_lap_channel_samples              (NULL)
    , m_p_func_get_GPS_channels_count               (NULL)
    , m_p_func_get_GPS_channel_name                 (NULL)
    , m_p_func_get_GPS_channel_units                (NULL)
    , m_p_func_get_GPS_channel_samples_count        (NULL)
    , m_p_func_get_GPS_channel_samples              (NULL)
    , m_p_func_get_lap_GPS_channel_samples_count    (NULL)
    , m_p_func_get_lap_GPS_channel_samples          (NULL)
    , m_p_func_get_GPS_raw_channels_count           (NULL)
    , m_p_func_get_GPS_raw_channel_name             (NULL)
    , m_p_func_get_GPS_raw_channel_units            (NULL)
    , m_p_func_get_GPS_raw_channel_samples_count    (NULL)
    , m_p_func_get_GPS_raw_channel_samples          (NULL)
    , m_p_func_get_lap_GPS_raw_channel_samples_count(NULL)
    , m_p_func_get_lap_GPS_raw_channel_samples      (NULL)
    , m_p_func_library_test_on_open_files           (NULL)
    , m_pInfo(new CInfoMsgBox)
    , m_b_clicked_gps_chan_cnt(false)
    , m_b_clicked_gps_raw_chan_cnt(false)
{
    m_hIcon = AfxGetApp()->LoadIcon(IDR_MAINFRAME);
}

CTestMatLabXRKDlg::~CTestMatLabXRKDlg()
{
    if (m_pInfo)
    {
        delete m_pInfo;
        m_pInfo = NULL;
    }
}

void CTestMatLabXRKDlg::DoDataExchange(CDataExchange* pDX)
{
    CDialogEx::DoDataExchange(pDX);
    DDX_Text(pDX, IDC_STATIC_INFO, m_output_info);
}

BEGIN_MESSAGE_MAP(CTestMatLabXRKDlg, CDialogEx)
    ON_WM_SYSCOMMAND()
    ON_WM_PAINT()
    ON_WM_QUERYDRAGICON()
    ON_WM_CLOSE()
    ON_BN_CLICKED(IDC_BUTTON_OPEN, &CTestMatLabXRKDlg::OnBnClickedButtonOpen)
    ON_BN_CLICKED(IDC_BUTTON_CLOSE, &CTestMatLabXRKDlg::OnBnClickedButtonClose)
    ON_BN_CLICKED(IDC_BUTTON_CH_COUNT, &CTestMatLabXRKDlg::OnBnClickedButtonChCount)
    ON_BN_CLICKED(IDC_BUTTON_CH_NAMES, &CTestMatLabXRKDlg::OnBnClickedButtonChNames)
    ON_BN_CLICKED(IDC_BUTTON_CH_DATA, &CTestMatLabXRKDlg::OnBnClickedButtonChData)
    ON_BN_CLICKED(IDC_BUTTON_LAP_DATA, &CTestMatLabXRKDlg::OnBnClickedButtonLapData)
    ON_BN_CLICKED(IDC_BUTTON_LAP_COUNT, &CTestMatLabXRKDlg::OnBnClickedButtonLapCount)
    ON_BN_CLICKED(IDC_BUTTON_LAP_TIMES, &CTestMatLabXRKDlg::OnBnClickedButtonLapTimes)
    ON_BN_CLICKED(IDC_BUTTON_VEHICLE, &CTestMatLabXRKDlg::OnBnClickedButtonVehicle)
    ON_BN_CLICKED(IDC_BUTTON_TRACK, &CTestMatLabXRKDlg::OnBnClickedButtonTrack)
    ON_BN_CLICKED(IDC_BUTTON_RACER, &CTestMatLabXRKDlg::OnBnClickedButtonRacer)
    ON_BN_CLICKED(IDC_BUTTON_CHAMPIONSHIP, &CTestMatLabXRKDlg::OnBnClickedButtonChampionship)
    ON_BN_CLICKED(IDC_BUTTON_SESSION_TYPE, &CTestMatLabXRKDlg::OnBnClickedButtonSessionType)
    ON_BN_CLICKED(IDC_BUTTON_DATE_TIME, &CTestMatLabXRKDlg::OnBnClickedButtonDateTime)
    ON_BN_CLICKED(IDC_BUTTON_DLL_VERSION, &CTestMatLabXRKDlg::OnBnClickedButtonDllVersion)
    ON_BN_CLICKED(IDC_BUTTON_RUN_TEST, &CTestMatLabXRKDlg::OnBnClickedButtonRunTest)
    ON_BN_CLICKED(IDC_BUTTON_GPSCH_COUNT, &CTestMatLabXRKDlg::OnBnClickedButtonGPSChCount)
    ON_BN_CLICKED(IDC_BUTTON_GPSCH_NAMES, &CTestMatLabXRKDlg::OnBnClickedButtonGPSChNames)
    ON_BN_CLICKED(IDC_BUTTON_GPSCH_DATA, &CTestMatLabXRKDlg::OnBnClickedButtonGPSChData)
    ON_BN_CLICKED(IDC_BUTTON_GPSLAP_DATA, &CTestMatLabXRKDlg::OnBnClickedButtonGPSLapData)
    ON_BN_CLICKED(IDC_BUTTON_GPSRAWCH_COUNT, &CTestMatLabXRKDlg::OnBnClickedButtonGPSRawChCount)
    ON_BN_CLICKED(IDC_BUTTON_GPSRAWCH_NAMES, &CTestMatLabXRKDlg::OnBnClickedButtonGPSRawChNames)
    ON_BN_CLICKED(IDC_BUTTON_GPSRAWCH_DATA, &CTestMatLabXRKDlg::OnBnClickedButtonGPSRawChData)
    ON_BN_CLICKED(IDC_BUTTON_GPSRAWLAP_DATA, &CTestMatLabXRKDlg::OnBnClickedButtonGPSRawLapData)
    ON_BN_CLICKED(IDC_BUTTON_CSV, &CTestMatLabXRKDlg::OnBnClickedButtonCsv)
    ON_BN_CLICKED(IDC_BUTTON_LICENCE, &CTestMatLabXRKDlg::OnBnClickedButtonLicence)
    ON_BN_CLICKED(IDC_BUTTON_LIB_TEST, &CTestMatLabXRKDlg::OnBnClickedButtonLibTest)
END_MESSAGE_MAP()

BOOL CTestMatLabXRKDlg::OnInitDialog()
{
    CDialogEx::OnInitDialog();

    ASSERT((IDM_ABOUTBOX & 0xFFF0) == IDM_ABOUTBOX);
    ASSERT(IDM_ABOUTBOX < 0xF000);

    CMenu* pSysMenu = GetSystemMenu(FALSE);
    if (pSysMenu != NULL)
    {
        BOOL bNameValid;
        CString strAboutMenu;
        bNameValid = strAboutMenu.LoadString(IDS_ABOUTBOX);
        ASSERT(bNameValid);
        if (!strAboutMenu.IsEmpty())
        {
            pSysMenu->AppendMenu(MF_SEPARATOR);
            pSysMenu->AppendMenu(MF_STRING, IDM_ABOUTBOX, strAboutMenu);
        }
    }

    SetIcon(m_hIcon, TRUE);			// Set big icon
    SetIcon(m_hIcon, FALSE);		// Set small icon

    srand( (unsigned)time( NULL ) );

    // start dll initialization ---------------------------------------------------------------------

    CString dll_name(_T("MatLabXRK-"));
#if _MSC_VER >= 1934
    dll_name.Append(_T("2022-"));
#elif _MSC_VER >= 1921
    dll_name.Append(_T("2019-"));
#elif _MSC_VER >= 1910
    dll_name.Append(_T("2017-"));
#else
    dll_name.Append(_T("2010-"));
#endif
#ifdef _WIN64
    dll_name.Append(_T("64-"));
#else
    dll_name.Append(_T("32-"));
#endif
#ifdef _DEBUG
    dll_name.Append(_T("DebugU.dll"));
#else
    dll_name.Append(_T("ReleaseU.dll"));
#endif
    m_hdl = LoadLibrary(dll_name.GetString());

    if (m_hdl)
    {
        m_p_func_get_library_date                      = reinterpret_cast< func_ptr_get_library_date                      >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_library_date"                      ) ) );
        m_p_func_get_library_time                      = reinterpret_cast< func_ptr_get_library_time                      >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_library_time"                      ) ) );
        m_p_func_open_file                             = reinterpret_cast< func_ptr_open_file                             >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "open_file"                             ) ) );
        m_p_func_open_file_with_licence                = reinterpret_cast< func_ptr_open_file_with_licence                >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "open_file_with_licence"                ) ) );
        m_p_func_close_file_n                          = reinterpret_cast< func_ptr_close_file_n                          >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "close_file_n"                          ) ) );
        m_p_func_close_file_i                          = reinterpret_cast< func_ptr_close_file_i                          >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "close_file_i"                          ) ) );
        m_p_func_get_vehicle_name                      = reinterpret_cast< func_ptr_get_vehicle_name                      >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_vehicle_name"                      ) ) );
        m_p_func_get_track_name                        = reinterpret_cast< func_ptr_get_track_name                        >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_track_name"                        ) ) );
        m_p_func_get_racer_name                        = reinterpret_cast< func_ptr_get_racer_name                        >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_racer_name"                        ) ) );
        m_p_func_get_championship_name                 = reinterpret_cast< func_ptr_get_championship_name                 >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_championship_name"                 ) ) );
        m_p_func_get_session_type_name                 = reinterpret_cast< func_ptr_get_session_type_name                 >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_session_type_name"                   ) ) );
        m_p_func_get_date_and_time                     = reinterpret_cast< func_ptr_get_date_and_time                     >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_date_and_time"                     ) ) );
        m_p_func_get_laps_count                        = reinterpret_cast< func_ptr_get_laps_count                        >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_laps_count"                        ) ) );
        m_p_func_get_lap_info                          = reinterpret_cast< func_ptr_get_lap_info                          >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_lap_info"                          ) ) );
        m_p_func_get_channels_count                    = reinterpret_cast< func_ptr_get_channels_count                    >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_channels_count"                    ) ) );
        m_p_func_get_channel_name                      = reinterpret_cast< func_ptr_get_channel_name                      >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_channel_name"                      ) ) );
        m_p_func_get_channel_units                     = reinterpret_cast< func_ptr_get_channel_units                     >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_channel_units"                     ) ) );
        m_p_func_get_channel_samples_count             = reinterpret_cast< func_ptr_get_channel_samples_count             >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_channel_samples_count"             ) ) );
        m_p_func_get_channel_samples                   = reinterpret_cast< func_ptr_get_channel_samples                   >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_channel_samples"                   ) ) );
        m_p_func_get_lap_channel_samples_count         = reinterpret_cast< func_ptr_get_lap_channel_samples_count         >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_lap_channel_samples_count"         ) ) );
        m_p_func_get_lap_channel_samples               = reinterpret_cast< func_ptr_get_lap_channel_samples               >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_lap_channel_samples"               ) ) );
        m_p_func_get_GPS_channels_count                = reinterpret_cast< func_ptr_get_GPS_channels_count                >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_GPS_channels_count"                ) ) );
        m_p_func_get_GPS_channel_name                  = reinterpret_cast< func_ptr_get_GPS_channel_name                  >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_GPS_channel_name"                  ) ) );
        m_p_func_get_GPS_channel_units                 = reinterpret_cast< func_ptr_get_GPS_channel_units                 >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_GPS_channel_units"                 ) ) );
        m_p_func_get_GPS_channel_samples_count         = reinterpret_cast< func_ptr_get_GPS_channel_samples_count         >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_GPS_channel_samples_count"         ) ) );
        m_p_func_get_GPS_channel_samples               = reinterpret_cast< func_ptr_get_GPS_channel_samples               >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_GPS_channel_samples"               ) ) );
        m_p_func_get_lap_GPS_channel_samples_count     = reinterpret_cast< func_ptr_get_lap_GPS_channel_samples_count     >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_lap_GPS_channel_samples_count"     ) ) );
        m_p_func_get_lap_GPS_channel_samples           = reinterpret_cast< func_ptr_get_lap_GPS_channel_samples           >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_lap_GPS_channel_samples"           ) ) );
        m_p_func_get_GPS_raw_channels_count            = reinterpret_cast< func_ptr_get_GPS_raw_channels_count            >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_GPS_raw_channels_count"            ) ) );
        m_p_func_get_GPS_raw_channel_name              = reinterpret_cast< func_ptr_get_GPS_raw_channel_name              >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_GPS_raw_channel_name"              ) ) );
        m_p_func_get_GPS_raw_channel_units             = reinterpret_cast< func_ptr_get_GPS_raw_channel_units             >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_GPS_raw_channel_units"             ) ) );
        m_p_func_get_GPS_raw_channel_samples_count     = reinterpret_cast< func_ptr_get_GPS_raw_channel_samples_count     >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_GPS_raw_channel_samples_count"     ) ) );
        m_p_func_get_GPS_raw_channel_samples           = reinterpret_cast< func_ptr_get_GPS_raw_channel_samples           >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_GPS_raw_channel_samples"           ) ) );
        m_p_func_get_lap_GPS_raw_channel_samples_count = reinterpret_cast< func_ptr_get_lap_GPS_raw_channel_samples_count >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_lap_GPS_raw_channel_samples_count" ) ) );
        m_p_func_get_lap_GPS_raw_channel_samples       = reinterpret_cast< func_ptr_get_lap_GPS_raw_channel_samples       >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "get_lap_GPS_raw_channel_samples"       ) ) );
        m_p_func_library_test_on_open_files            = reinterpret_cast< func_ptr_library_test_on_open_files            >( reinterpret_cast<void*>(GetProcAddress( m_hdl, "library_test_on_open_files"            ) ) );
    }
    else
    {
        DWORD error = GetLastError();
        CString str;
        str.Format(_T("No library found - error : %u"), error);
        AfxMessageBox(str);
    }

    // end dll initialization -----------------------------------------------------------------------

    return TRUE;
}

void CTestMatLabXRKDlg::OnSysCommand(UINT nID, LPARAM lParam)
{
    if ((nID & 0xFFF0) == IDM_ABOUTBOX)
    {
        CAboutDlg dlgAbout;
        dlgAbout.DoModal();
    }
    else
    {
        CDialogEx::OnSysCommand(nID, lParam);
    }
}

void CTestMatLabXRKDlg::OnPaint()
{
    if (IsIconic())
    {
        CPaintDC dc(this);

        SendMessage(WM_ICONERASEBKGND, reinterpret_cast<WPARAM>(dc.GetSafeHdc()), 0);

        int cxIcon = GetSystemMetrics(SM_CXICON);
        int cyIcon = GetSystemMetrics(SM_CYICON);
        CRect rect;
        GetClientRect(&rect);
        int x = (rect.Width() - cxIcon + 1) / 2;
        int y = (rect.Height() - cyIcon + 1) / 2;

        dc.DrawIcon(x, y, m_hIcon);
    }
    else
    {
        CDialogEx::OnPaint();
    }
}

HCURSOR CTestMatLabXRKDlg::OnQueryDragIcon()
{
    return static_cast<HCURSOR>(m_hIcon);
}

void CTestMatLabXRKDlg::Free()
{
    if (m_idx > 0)
    {
        OnBnClickedButtonClose();
    }

    if (m_hdl)
    {
        FreeLibrary( m_hdl );
    }

    m_p_func_get_library_date                      = NULL;
    m_p_func_get_library_time                      = NULL;
    m_p_func_open_file                             = NULL;
    m_p_func_open_file_with_licence                = NULL;
    m_p_func_close_file_n                          = NULL;
    m_p_func_close_file_i                          = NULL;
    m_p_func_get_vehicle_name                      = NULL;
    m_p_func_get_track_name                        = NULL;
    m_p_func_get_racer_name                        = NULL;
    m_p_func_get_championship_name                 = NULL;
    m_p_func_get_session_type_name                 = NULL;
    m_p_func_get_date_and_time                     = NULL;
    m_p_func_get_laps_count                        = NULL;
    m_p_func_get_lap_info                          = NULL;
    m_p_func_get_channels_count                    = NULL;
    m_p_func_get_channel_name                      = NULL;
    m_p_func_get_channel_units                     = NULL;
    m_p_func_get_channel_samples_count             = NULL;
    m_p_func_get_channel_samples                   = NULL;
    m_p_func_get_lap_channel_samples_count         = NULL;
    m_p_func_get_lap_channel_samples               = NULL;
    m_p_func_get_GPS_channels_count                = NULL;
    m_p_func_get_GPS_channel_name                  = NULL;
    m_p_func_get_GPS_channel_units                 = NULL;
    m_p_func_get_GPS_channel_samples_count         = NULL;
    m_p_func_get_GPS_channel_samples               = NULL;
    m_p_func_get_lap_GPS_channel_samples_count     = NULL;
    m_p_func_get_lap_GPS_channel_samples           = NULL;
    m_p_func_get_GPS_raw_channels_count            = NULL;
    m_p_func_get_GPS_raw_channel_name              = NULL;
    m_p_func_get_GPS_raw_channel_units             = NULL;
    m_p_func_get_GPS_raw_channel_samples_count     = NULL;
    m_p_func_get_GPS_raw_channel_samples           = NULL;
    m_p_func_get_lap_GPS_raw_channel_samples_count = NULL;
    m_p_func_get_lap_GPS_raw_channel_samples       = NULL;
    m_p_func_library_test_on_open_files            = NULL;
}

void CTestMatLabXRKDlg::OnClose()
{
    Free();

    CDialogEx::OnClose();
}

void CTestMatLabXRKDlg::OnCancel()
{
    Free();

    CDialogEx::OnCancel();
}

void CTestMatLabXRKDlg::OnBnClickedButtonDllVersion()
{
    if (!m_p_func_get_library_date)
    {
        AfxMessageBox(_T("No function for date"));
        return;
    }
    if (!m_p_func_get_library_time)
    {
        AfxMessageBox(_T("No function for time"));
        return;
    }

    char const* str_date = m_p_func_get_library_date();
    char const* str_time = m_p_func_get_library_time();
    if ((str_date) && (str_time))
    {
        CString s_date(str_date);
        CString s_time(str_time);
        CString str;
        str.Format(_T("Date:\t%s\nTime:\t%s"), s_date.GetString(), s_time.GetString());
        AfxMessageBox(str);
    }
}

bool GetFileToOpen(CString& name, CString const& folder)
{
    CString nomeTmp = name;
    CString cartellaTmp = folder;

    DWORD dwFlags = OFN_HIDEREADONLY | OFN_EXPLORER | OFN_ENABLESIZING | OFN_FILEMUSTEXIST;

    CString szFilters = _T("XRK Files (*.xrk)|*.xrk|XRZ Files (*.xrz)|*.xrz|DRK Files (*.drk)|*.drk||");
    CFileDialog dlg( TRUE
        , _T("xrk")
        , _T("*.xrk")
        , dwFlags
        , szFilters.GetString()
        , AfxGetMainWnd()
        , sizeof(OPENFILENAME)
        );

    OPENFILENAME& ofn = dlg.GetOFN();

    ofn.lpstrInitialDir = cartellaTmp.GetString();

    if (dlg.DoModal() != IDOK)
        return false;

    POSITION posiz = dlg.GetStartPosition();
    if (posiz == NULL)
        return false;

    name = dlg.GetNextPathName(posiz);
    CString lname(name);
    lname.MakeLower();
    if (lname.Find(_T(".xrk"), lname.GetLength()-4) == lname.GetLength()-4)
    {
        return true;
    }
    else if (lname.Find(_T(".xrz"), lname.GetLength()-4) == lname.GetLength()-4)
    {
        return true;
    }
    else if (lname.Find(_T(".drk"), lname.GetLength() - 4) == lname.GetLength() - 4)
    {
        return true;
    }

    return false;
}

#define CHOOSE_FILE_WITH_DLG

void CTestMatLabXRKDlg::OnBnClickedButtonOpen()
{
    if (m_idx > 0)
    {
        OnBnClickedButtonClose();
    }

    if ((m_p_func_open_file) && (m_p_func_open_file_with_licence))
    {
        char currentDir[MAX_PATH];
        GetCurrentDirectoryA(MAX_PATH, currentDir);

#ifdef CHOOSE_FILE_WITH_DLG
        CString fullpathfile;
        CString folder(currentDir);
        if (!GetFileToOpen(fullpathfile, folder)) {
            return;
        }
#ifdef _UNICODE
        std::wstring Fullpath(fullpathfile.GetString());
#else // _UNICODE
        std::string Fullpath(fullpathfile.GetString());
#endif // _UNICODE
        //std::string fullpath(Fullpath.begin(), Fullpath.end());
        std::string fullpath;
        for (auto& c : Fullpath) {
            fullpath.push_back((char)c);
        }
#else // CHOOSE_FILE_WITH_DLG
        std::string fullpath(currentDir);
        fullpath.append("\\test.xrk");
#endif // CHOOSE_FILE_WITH_DLG

        int retval = 0;
        if (m_licence_file.IsEmpty())
        {
            retval = m_p_func_open_file(fullpath.c_str());
        }
        else
        {
#ifdef _UNICODE
            std::wstring FullpathLic(m_licence_file.GetString());
#else // _UNICODE
            std::string FullpathLic(m_licence_file.GetString());
#endif // _UNICODE
            //std::string fullpath_licence(FullpathLic.begin(), FullpathLic.end());
            std::string fullpath_licence;
            for (auto& c : FullpathLic) {
                fullpath_licence.push_back((char)c);
            }
            retval = m_p_func_open_file_with_licence(fullpath.c_str(), fullpath_licence.c_str());
        }

        if (retval > 0)
        {
            m_idx = retval;
            m_fullpath = fullpath;
            m_pInfo->DoInform(_T("File is open"));
        }
        else {
            AfxMessageBox(_T("Can't open file"));
        }
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonClose()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    m_b_clicked_gps_chan_cnt = false;
    m_b_clicked_gps_raw_chan_cnt = false;

    if (m_p_func_close_file_i)
    {
        m_p_func_close_file_i(m_idx);
        m_idx = 0;
        m_fullpath = "";
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonVehicle()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_get_vehicle_name)
    {
        char const* name = m_p_func_get_vehicle_name(m_idx);
        CString nome(name);
        CString str;
        str.Format(_T("Vehicle: %s"), nome.GetString());
        m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonTrack()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_get_track_name)
    {
        char const* name = m_p_func_get_track_name(m_idx);
        CString nome(name);
        CString str;
        str.Format(_T("Track: %s"), nome.GetString());
        m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonRacer()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_get_racer_name)
    {
        char const* name = m_p_func_get_racer_name(m_idx);
        CString nome(name);
        CString str;
        str.Format(_T("Racer: %s"), nome.GetString());
        m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonChampionship()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_get_championship_name)
    {
        char const* name = m_p_func_get_championship_name(m_idx);
        CString nome(name);
        CString str;
        str.Format(_T("Championship: %s"), nome.GetString());
        m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonSessionType()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_get_session_type_name)
    {
        char const* name = m_p_func_get_session_type_name(m_idx);
        CString nome(name);
        CString str;
        str.Format(_T("Session Type: %s"), nome.GetString());
        m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonDateTime()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_get_date_and_time)
    {
        struct tm const* dt = m_p_func_get_date_and_time(m_idx);
        if (dt)
        {
            CString str;
            str.Format(_T("YYYY-MM-DD hh:mm:ss   -  %04d-%02d-%02d %02d:%02d:%02d"), dt->tm_year + 1900, dt->tm_mon + 1, dt->tm_mday, dt->tm_hour, dt->tm_min, dt->tm_sec);
            m_pInfo->DoInform(str);
        }
        else
        {
            AfxMessageBox(_T("No date and time"));
        }
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonLapCount()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_get_laps_count)
    {
        int count = m_p_func_get_laps_count(m_idx);
        CString str;
        str.Format(_T("Laps count is %d"), count);
        m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonLapTimes()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if ( (m_p_func_get_laps_count) && (m_p_func_get_lap_info) )
    {
        int count = m_p_func_get_laps_count(m_idx);
        if (count > 20)
        {
            int idx = rand() % count;
            double start = 0.0;
            double duration = 0.0;
            if (m_p_func_get_lap_info(m_idx, idx, &start, &duration) == 1)
            {
                CString str;
                str.Format(_T("Lap [%d] - start %lf (s) - duration %lf (s)"), idx, start, duration);
                m_pInfo->DoInform(str);
            }
            else
            {
                AfxMessageBox(_T("No lap info recovered"));
            }
        }
        else
        {
            CString str;
            str.Format(_T("Laps %d:"), count);
            for (int idx=0; idx<count; ++idx)
            {
                double start = 0.0;
                double duration = 0.0;
                if (m_p_func_get_lap_info(m_idx, idx, &start, &duration) == 1)
                {
                    str.AppendFormat(_T("\nLap [%d] - start %lf (s) - duration %lf (s)"), idx, start, duration);
                }
                else
                {
                    str.AppendFormat(_T("\nLap [%d] - No lap info recovered"), idx);
                }
            }
            m_pInfo->DoInform(str);
        }
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonLibTest()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_library_test_on_open_files)
    {
        std::string const str_lib = m_p_func_library_test_on_open_files();

		std::string file_csv(m_fullpath + ".txt");
		std::ofstream ofs(file_csv);
		if (ofs.is_open())
		{
			ofs.write(str_lib.c_str(), str_lib.length());
			ofs.close();
		}

#ifdef _UNICODE
		std::wstring Fullpath(m_fullpath.begin(), m_fullpath.end());
#else // _UNICODE
		std::string Fullpath(m_fullpath.begin(), m_fullpath.end());
#endif // _UNICODE
		CString str;
		str.Format(_T("CSV file is ready: %s.txt"), Fullpath.c_str());
		m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonCsv()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    struct SSamples
    {
        SSamples()
            : count(0)
            , pTimes(nullptr)
            , pValues(nullptr)
        {}
        ~SSamples()
        {
            Reset();
        }
        void Reset()
        {
            if (pTimes)
            {
                if (count > 1) { delete[] pTimes; } else { delete pTimes; }
                pTimes = nullptr;
            }
            if (pValues)
            {
                if (count > 1) { delete[] pValues; } else { delete pValues; }
                pValues = nullptr;
            }
            count = 0;
        }
        void SetCount(int c)
        {
            Reset();
            if (c > 1)
            {
                count = c;
                pTimes = new double[(size_t)c];
                pValues = new double[(size_t)c];
            }
            else if (c == 1)
            {
                count = c;
                pTimes = new double;
                pValues = new double;
            }
            if (pTimes) memset(pTimes, 0, c * sizeof(double));
            if (pValues) memset(pValues, 0, c * sizeof(double));
        }
        int GetCount() {
            return count;
        }
        void ToString(std::stringstream& ss)
        {
            int tot_printed = min(count, 3);
            for (int ii = 0; ii < tot_printed; ++ii)
            {
                ss << " (" << pTimes[ii] << "," << pValues[ii] << ")";
            }
            ss << " ...";
            tot_printed = max(0, count - 3);
            for (int ii = tot_printed; ii < count; ++ii)
            {
                ss << " (" << pTimes[ii] << "," << pValues[ii] << ")";
            }
        }
    private:
        int count;
    public:
        double * pTimes;
        double * pValues;
    };

    struct SLap
    {
        SLap()
            : start(0.0)
            , duration(0.0)
        {}
        void ToString(int idx, std::stringstream& ss)
        {
            ss << "Lap " << idx << " start " << start << " duration " << duration;
        }

        double start;
        double duration;
    };

    struct SChannel
    {
        SChannel()
        {}
        void ToString(std::string type, int idx, std::stringstream& ss)
        {
            size_t tot_laps = laps.size();
            int tot_samples = 0;
            for (size_t ii = 0; ii < tot_laps; ++ii)
            {
                tot_samples += lap_samples[ii].GetCount();
            }

            ss << type << " " << idx << " " << name << " [" << units << "] " << samples.GetCount() << " samples (" << tot_samples << ")" << std::endl;

            for (size_t ii = 0; ii < tot_laps; ++ii)
            {
                laps[ii].ToString((int)ii, ss);
                lap_samples[ii].ToString(ss);
                ss << " end " << (laps[ii].start + laps[ii].duration) << " n_samples " << lap_samples[ii].GetCount() << std::endl;
            }
        }

        std::string name;
        std::string units;

        SSamples samples;
        std::vector<SLap> laps;
        std::vector<SSamples> lap_samples;
    };

    int chs_count_ = m_p_func_get_channels_count(m_idx);
    int gps_count_ = m_p_func_get_GPS_channels_count(m_idx);
    int raw_count_ = m_p_func_get_GPS_raw_channels_count(m_idx);

    if ((chs_count_ <= 0) || (gps_count_ <= 0) || (raw_count_ <= 0))
    {
        AfxMessageBox(_T("Bad measures"));
        return;
    }

    size_t chs_count = (size_t) chs_count_;
    size_t gps_count = (size_t) gps_count_;
    size_t raw_count = (size_t) raw_count_;

    std::vector<SChannel> chs(chs_count);
    std::vector<SChannel> gps(gps_count);
    std::vector<SChannel> raw(raw_count);

    for (size_t idx_chs = 0; idx_chs < chs_count; idx_chs++)
    {
        chs[idx_chs].name = m_p_func_get_channel_name(m_idx, (int)idx_chs);
        chs[idx_chs].units = m_p_func_get_channel_units(m_idx, (int)idx_chs);

        chs[idx_chs].samples.SetCount(m_p_func_get_channel_samples_count(m_idx, (int)idx_chs));
        m_p_func_get_channel_samples(m_idx, (int)idx_chs, chs[idx_chs].samples.pTimes, chs[idx_chs].samples.pValues, chs[idx_chs].samples.GetCount());
    }

    for (size_t idx_gps = 0; idx_gps < gps_count; idx_gps++)
    {
        gps[idx_gps].name = m_p_func_get_GPS_channel_name(m_idx, (int)idx_gps);
        gps[idx_gps].units = m_p_func_get_GPS_channel_units(m_idx, (int)idx_gps);

        gps[idx_gps].samples.SetCount(m_p_func_get_GPS_channel_samples_count(m_idx, (int)idx_gps));
        m_p_func_get_GPS_channel_samples(m_idx, (int)idx_gps, gps[idx_gps].samples.pTimes, gps[idx_gps].samples.pValues, gps[idx_gps].samples.GetCount());
    }

    for (size_t idx_raw = 0; idx_raw < raw_count; idx_raw++)
    {
        raw[idx_raw].name = m_p_func_get_GPS_raw_channel_name(m_idx, (int)idx_raw);
        raw[idx_raw].units = m_p_func_get_GPS_raw_channel_units(m_idx, (int)idx_raw);

        raw[idx_raw].samples.SetCount(m_p_func_get_GPS_raw_channel_samples_count(m_idx, (int)idx_raw));
        m_p_func_get_GPS_raw_channel_samples(m_idx, (int)idx_raw, raw[idx_raw].samples.pTimes, raw[idx_raw].samples.pValues, raw[idx_raw].samples.GetCount());
    }

    int laps_count = m_p_func_get_laps_count(m_idx);

    for (size_t idx_chs = 0; idx_chs < chs_count; idx_chs++)
    {
        chs[idx_chs].laps.resize((size_t)laps_count);
        chs[idx_chs].lap_samples.resize((size_t)laps_count);
    }
    for (size_t idx_gps = 0; idx_gps < gps_count; idx_gps++)
    {
        gps[idx_gps].laps.resize((size_t)laps_count);
        gps[idx_gps].lap_samples.resize((size_t)laps_count);
    }
    for (size_t idx_raw = 0; idx_raw < raw_count; idx_raw++)
    {
        raw[idx_raw].laps.resize((size_t)laps_count);
        raw[idx_raw].lap_samples.resize((size_t)laps_count);
    }

    std::stringstream ss;

    for (int idx_lap = 0; idx_lap < laps_count; ++idx_lap)
    {
        double start = 0.0;
        double duration = 0.0;
        m_p_func_get_lap_info(m_idx, idx_lap, &start, &duration);

        for (size_t idx_chs = 0; idx_chs < chs_count; idx_chs++)
        {
            chs[idx_chs].laps[(size_t)idx_lap].start = start;
            chs[idx_chs].laps[(size_t)idx_lap].duration = duration;
            chs[idx_chs].lap_samples[(size_t)idx_lap].SetCount(m_p_func_get_lap_channel_samples_count(m_idx, idx_lap, (int)idx_chs));
            m_p_func_get_lap_channel_samples(m_idx, idx_lap, (int)idx_chs, chs[idx_chs].lap_samples[(size_t)idx_lap].pTimes, chs[idx_chs].lap_samples[(size_t)idx_lap].pValues, chs[idx_chs].lap_samples[(size_t)idx_lap].GetCount());
        }
        for (size_t idx_gps = 0; idx_gps < gps_count; idx_gps++)
        {
            gps[idx_gps].laps[(size_t)idx_lap].start = start;
            gps[idx_gps].laps[(size_t)idx_lap].duration = duration;
            gps[idx_gps].lap_samples[(size_t)idx_lap].SetCount(m_p_func_get_lap_GPS_channel_samples_count(m_idx, idx_lap, (int)idx_gps));
            m_p_func_get_lap_GPS_channel_samples(m_idx, idx_lap, (int)idx_gps, gps[idx_gps].lap_samples[(size_t)idx_lap].pTimes, gps[idx_gps].lap_samples[(size_t)idx_lap].pValues, gps[idx_gps].lap_samples[(size_t)idx_lap].GetCount());
        }
        for (size_t idx_raw = 0; idx_raw < raw_count; idx_raw++)
        {
            raw[idx_raw].laps[(size_t)idx_lap].start = start;
            raw[idx_raw].laps[(size_t)idx_lap].duration = duration;
            raw[idx_raw].lap_samples[(size_t)idx_lap].SetCount(m_p_func_get_lap_GPS_raw_channel_samples_count(m_idx, idx_lap, (int)idx_raw));
            m_p_func_get_lap_GPS_raw_channel_samples(m_idx, idx_lap, (int)idx_raw, raw[idx_raw].lap_samples[(size_t)idx_lap].pTimes, raw[idx_raw].lap_samples[(size_t)idx_lap].pValues, raw[idx_raw].lap_samples[(size_t)idx_lap].GetCount());
        }
    }

    for (size_t idx_chs = 0; idx_chs < chs_count; idx_chs++)
    {
        chs[idx_chs].ToString("Channel", (int)idx_chs, ss);
    }
    for (size_t idx_gps = 0; idx_gps < gps_count; idx_gps++)
    {
        gps[idx_gps].ToString("GPS Channel", (int)idx_gps, ss);
    }
    for (size_t idx_raw = 0; idx_raw < raw_count; idx_raw++)
    {
        raw[idx_raw].ToString("GPS Raw Channel", (int)idx_raw, ss);
    }

    std::string file_csv(m_fullpath + ".csv");
    std::ofstream ofs(file_csv);
    if (ofs.is_open())
    {
        ofs.write(ss.str().c_str(), ss.str().length());
        ofs.close();
    }

#ifdef _UNICODE
    std::wstring Fullpath(m_fullpath.begin(), m_fullpath.end());
#else // _UNICODE
    std::string Fullpath(m_fullpath.begin(), m_fullpath.end());
#endif // _UNICODE
    CString str;
    str.Format(_T("CSV file is ready: %s.csv"), Fullpath.c_str());
    m_pInfo->DoInform(str);
}


void CTestMatLabXRKDlg::OnBnClickedButtonChCount()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_get_channels_count)
    {
        int count = m_p_func_get_channels_count(m_idx);
        CString str;
        str.Format(_T("Channels count is %d"), count);
        m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonChNames()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if ( (m_p_func_get_channels_count) && (m_p_func_get_channel_name) && (m_p_func_get_channel_units) )
    {
        int count = m_p_func_get_channels_count(m_idx);
        CString str;
#ifdef _DEBUG
        for (int idx=0; idx<count; ++idx)
        {
            char const* name = m_p_func_get_channel_name(m_idx, idx);
            CString nome(name);
            char const* units = m_p_func_get_channel_units(m_idx, idx);
            CString unita(units);
            str.AppendFormat(_T("Channel [%d] %s [%s]\n"), idx, nome.GetString(), unita.GetString());
        }
#else
        int idx = rand() % count;
        char const* name = m_p_func_get_channel_name(m_idx, idx);
        CString nome(name);
        char const* units = m_p_func_get_channel_units(m_idx, idx);
        CString unita(units);
        str.Format(_T("Channel [%d] %s [%s]\n"), idx, nome.GetString(), unita.GetString());
#endif
        m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonChData()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if ( (m_p_func_get_channels_count) && (m_p_func_get_channel_samples_count) && (m_p_func_get_channel_samples) )
    {
        int count = m_p_func_get_channels_count(m_idx);
        int idx = rand() % count;
        int samples = m_p_func_get_channel_samples_count(m_idx, idx);
        if (samples > 1)
        {
            double * times = new double[(size_t)samples];
            double * values = new double[(size_t)samples];
            if ( (times) && (values) )
            {
                if (m_p_func_get_channel_samples(m_idx, idx, times, values, samples) > 0)
                {
                    int sample = rand() % samples;
                    CString str;
                    str.Format(_T("Channel [%d] Sample [%d] - time %lf - value %lf"), idx, sample, times[sample], values[sample]);
                    m_pInfo->DoInform(str);
                }
                else
                {
                    AfxMessageBox(_T("No samples recovered"));
                }
            }
            else
            {
                AfxMessageBox(_T("Can't alloc"));
            }
            if (times) {
                delete [] times;
            }
            if (values) {
                delete [] values;
            }
        }
        else
        {
            m_pInfo->DoInform(_T("No samples, maybe file is too small?"));
        }
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonLapData()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if ( (m_p_func_get_laps_count) && (m_p_func_get_channels_count) && (m_p_func_get_lap_channel_samples_count) && (m_p_func_get_lap_channel_samples) && (m_p_func_get_lap_info) )
    {
        int lcount = m_p_func_get_laps_count(m_idx);
        int ccount = m_p_func_get_channels_count(m_idx);

        int idxl = rand() % lcount;
        int idxc = rand() % ccount;

        double start = 0.0;
        double duration = 0.0;
        if (m_p_func_get_lap_info(m_idx, idxl, &start, &duration) == 1)
        {
            int samples = m_p_func_get_lap_channel_samples_count(m_idx, idxl, idxc);
            if (samples > 1)
            {
                double * times = new double[(size_t)samples];
                double * values = new double[(size_t)samples];
                if ( (times) && (values) )
                {
                    if (m_p_func_get_lap_channel_samples(m_idx, idxl, idxc, times, values, samples) > 0)
                    {
                        int sample = rand() % samples;
                        CString str;
                        str.Format(_T("Lap [%d] (start %lf - duration %lf) Channel [%d] Sample [%d] - time %lf - value %lf"), idxl, start, duration, idxc, sample, times[sample], values[sample]);
                        m_pInfo->DoInform(str);
                    }
                    else
                    {
                        AfxMessageBox(_T("No samples recovered"));
                    }
                }
                else
                {
                    AfxMessageBox(_T("Can't alloc"));
                }
                if (times) {
                    delete [] times;
                }
                if (values) {
                    delete [] values;
                }
            }
            else
            {
                m_pInfo->DoInform(_T("No samples, maybe file is too small?"));
            }
        }
        else
        {
            AfxMessageBox(_T("No lap info recovered"));
        }
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonGPSChCount()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_get_GPS_channels_count)
    {
        int count = m_p_func_get_GPS_channels_count(m_idx);
        CString str;
        str.Format(_T("GPS Channels count is %d"), count);
        m_pInfo->DoInform(str);

        m_b_clicked_gps_chan_cnt = true;
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonGPSChNames()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (!m_b_clicked_gps_chan_cnt)
    {
        AfxMessageBox(_T("Please click on 'GPS Ch. Count' button first!"));
        return;
    }

    if ( (m_p_func_get_GPS_channels_count) && (m_p_func_get_GPS_channel_name) && (m_p_func_get_GPS_channel_units) )
    {
        int count = m_p_func_get_GPS_channels_count(m_idx);
        CString str;
#ifdef _DEBUG
        for (int idx=0; idx<count; ++idx)
        {
            char const* name = m_p_func_get_GPS_channel_name(m_idx, idx);
            CString nome(name);
            char const* units = m_p_func_get_GPS_channel_units(m_idx, idx);
            CString unita(units);
            str.AppendFormat(_T("GPS Channel [%d] %s [%s]\n"), idx, nome.GetString(), unita.GetString());
        }
#else
        int idx = rand() % count;
        char const* name = m_p_func_get_GPS_channel_name(m_idx, idx);
        CString nome(name);
        char const* units = m_p_func_get_GPS_channel_units(m_idx, idx);
        CString unita(units);
        str.Format(_T("GPS Channel [%d] %s [%s]\n"), idx, nome.GetString(), unita.GetString());
#endif
        m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonGPSChData()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (!m_b_clicked_gps_chan_cnt)
    {
        AfxMessageBox(_T("Please click on 'GPS Ch. Count' button first!"));
        return;
    }

    if ( (m_p_func_get_GPS_channels_count) && (m_p_func_get_GPS_channel_samples_count) && (m_p_func_get_GPS_channel_samples) )
    {
        int count = m_p_func_get_GPS_channels_count(m_idx);
        int idx = rand() % count;
        int samples = m_p_func_get_GPS_channel_samples_count(m_idx, idx);
        if (samples > 1)
        {
            double * times = new double[(size_t)samples];
            double * values = new double[(size_t)samples];
            if ( (times) && (values) )
            {
                if (m_p_func_get_GPS_channel_samples(m_idx, idx, times, values, samples) > 0)
                {
                    int sample = rand() % samples;
                    CString str;
                    str.Format(_T("GPS Channel [%d] Sample [%d] - time %lf - value %lf"), idx, sample, times[sample], values[sample]);
                    m_pInfo->DoInform(str);
                }
                else
                {
                    AfxMessageBox(_T("No GPS samples recovered"));
                }
            }
            else
            {
                AfxMessageBox(_T("Can't alloc"));
            }
            if (times) {
                delete [] times;
            }
            if (values) {
                delete [] values;
            }
        }
        else
        {
            m_pInfo->DoInform(_T("No samples, maybe file is too small?"));
        }
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonGPSLapData()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if ( (m_p_func_get_laps_count) && (m_p_func_get_GPS_channels_count) && (m_p_func_get_lap_GPS_channel_samples_count) && (m_p_func_get_lap_GPS_channel_samples) && (m_p_func_get_lap_info) )
    {
        int lcount = m_p_func_get_laps_count(m_idx);
        int ccount = m_p_func_get_GPS_channels_count(m_idx);

        int idxl = rand() % lcount;
        int idxc = rand() % ccount;

        double start = 0.0;
        double duration = 0.0;
        if (m_p_func_get_lap_info(m_idx, idxl, &start, &duration) == 1)
        {
            int samples = m_p_func_get_lap_GPS_channel_samples_count(m_idx, idxl, idxc);
            if (samples > 1)
            {
                double * times = new double[(size_t)samples];
                double * values = new double[(size_t)samples];
                if ( (times) && (values) )
                {
                    if (m_p_func_get_lap_GPS_channel_samples(m_idx, idxl, idxc, times, values, samples) > 0)
                    {
                        int sample = rand() % samples;
                        CString str;
                        str.Format(_T("Lap [%d] (start %lf - duration %lf) GPS Channel [%d] Sample [%d] - time %lf - value %lf"), idxl, start, duration, idxc, sample, times[sample], values[sample]);
                        m_pInfo->DoInform(str);
                    }
                    else
                    {
                        AfxMessageBox(_T("No GPS samples recovered"));
                    }
                }
                else
                {
                    AfxMessageBox(_T("Can't alloc"));
                }
                if (times) {
                    delete [] times;
                }
                if (values) {
                    delete [] values;
                }
            }
            else
            {
                m_pInfo->DoInform(_T("No samples, maybe file is too small?"));
            }
        }
        else
        {
            AfxMessageBox(_T("No lap info recovered"));
        }
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonGPSRawChCount()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (m_p_func_get_GPS_raw_channels_count)
    {
        int count = m_p_func_get_GPS_raw_channels_count(m_idx);
        CString str;
        str.Format(_T("GPS Channels count is %d"), count);
        m_pInfo->DoInform(str);

        m_b_clicked_gps_raw_chan_cnt = true;
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonGPSRawChNames()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (!m_b_clicked_gps_raw_chan_cnt)
    {
        AfxMessageBox(_T("Please click on 'GPS Raw Ch. Count' button first!"));
        return;
    }

    if ( (m_p_func_get_GPS_raw_channels_count) && (m_p_func_get_GPS_raw_channel_name) && (m_p_func_get_GPS_raw_channel_units) )
    {
        int count = m_p_func_get_GPS_raw_channels_count(m_idx);
        CString str;
#ifdef _DEBUG
        for (int idx=0; idx<count; ++idx)
        {
            char const* name = m_p_func_get_GPS_raw_channel_name(m_idx, idx);
            CString nome(name);
            char const* units = m_p_func_get_GPS_raw_channel_units(m_idx, idx);
            CString unita(units);
            str.AppendFormat(_T("GPS Raw Channel [%d] %s [%s]\n"), idx, nome.GetString(), unita.GetString());
        }
#else
        int idx = rand() % count;
        char const* name = m_p_func_get_GPS_raw_channel_name(m_idx, idx);
        CString nome(name);
        char const* units = m_p_func_get_GPS_raw_channel_units(m_idx, idx);
        CString unita(units);
        str.Format(_T("GPS Raw Channel [%d] %s [%s]\n"), idx, nome.GetString(), unita.GetString());
#endif
        m_pInfo->DoInform(str);
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonGPSRawChData()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if (!m_b_clicked_gps_raw_chan_cnt)
    {
        AfxMessageBox(_T("Please click on 'GPS Raw Ch. Count' button first!"));
        return;
    }

    if ( (m_p_func_get_GPS_raw_channels_count) && (m_p_func_get_GPS_raw_channel_samples_count) && (m_p_func_get_GPS_raw_channel_samples) )
    {
        int count = m_p_func_get_GPS_raw_channels_count(m_idx);
        int idx = rand() % count;
        int samples = m_p_func_get_GPS_raw_channel_samples_count(m_idx, idx);
        if (samples > 1)
        {
            double * times = new double[(size_t)samples];
            double * values = new double[(size_t)samples];
            if ( (times) && (values) )
            {
                if (m_p_func_get_GPS_raw_channel_samples(m_idx, idx, times, values, samples) > 0)
                {
                    int sample = rand() % samples;
                    CString str;
                    str.Format(_T("GPS Raw Channel [%d] Sample [%d] - time %lf - value %lf"), idx, sample, times[sample], values[sample]);
                    m_pInfo->DoInform(str);
                }
                else
                {
                    AfxMessageBox(_T("No GPS Raw samples recovered"));
                }
            }
            else
            {
                AfxMessageBox(_T("Can't alloc"));
            }
            if (times) {
                delete [] times;
            }
            if (values) {
                delete [] values;
            }
        }
        else
        {
            m_pInfo->DoInform(_T("No samples, maybe file is too small?"));
        }
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}


void CTestMatLabXRKDlg::OnBnClickedButtonGPSRawLapData()
{
    if (m_idx <= 0)
    {
        AfxMessageBox(_T("No file"));
        return;
    }

    if ( (m_p_func_get_laps_count) && (m_p_func_get_GPS_raw_channels_count) && (m_p_func_get_lap_GPS_raw_channel_samples_count) && (m_p_func_get_lap_GPS_raw_channel_samples) && (m_p_func_get_lap_info) )
    {
        int lcount = m_p_func_get_laps_count(m_idx);
        int ccount = m_p_func_get_GPS_raw_channels_count(m_idx);

        int idxl = rand() % lcount;
        int idxc = rand() % ccount;

        double start = 0.0;
        double duration = 0.0;
        if (m_p_func_get_lap_info(m_idx, idxl, &start, &duration) == 1)
        {
            int samples = m_p_func_get_lap_GPS_raw_channel_samples_count(m_idx, idxl, idxc);
            if (samples > 1)
            {
                double * times = new double[(size_t)samples];
                double * values = new double[(size_t)samples];
                if ( (times) && (values) )
                {
                    if (m_p_func_get_lap_GPS_raw_channel_samples(m_idx, idxl, idxc, times, values, samples) > 0)
                    {
                        int sample = rand() % samples;
                        CString str;
                        str.Format(_T("Lap [%d] (start %lf - duration %lf) GPS Raw Channel [%d] Sample [%d] - time %lf - value %lf"), idxl, start, duration, idxc, sample, times[sample], values[sample]);
                        m_pInfo->DoInform(str);
                    }
                    else
                    {
                        AfxMessageBox(_T("No GPS Raw samples recovered"));
                    }
                }
                else
                {
                    AfxMessageBox(_T("Can't alloc"));
                }
                if (times) {
                    delete [] times;
                }
                if (values) {
                    delete [] values;
                }
            }
            else
            {
                m_pInfo->DoInform(_T("No samples, maybe file is too small?"));
            }
        }
        else
        {
            AfxMessageBox(_T("No lap info recovered"));
        }
    }
    else {
        AfxMessageBox(_T("No function"));
    }
}

// ------------------------------------------------------------------------------
CTestMatLabXRKDlg::CInfo::CInfo()
{}
CTestMatLabXRKDlg::CInfo::~CInfo()
{}

// ------------------------------------------------------------------------------
CTestMatLabXRKDlg::CInfoMsgBox::CInfoMsgBox()
{}
CTestMatLabXRKDlg::CInfoMsgBox::~CInfoMsgBox()
{}

void CTestMatLabXRKDlg::CInfoMsgBox::DoInform(CString const& msg)
{
    AfxMessageBox(msg);
}

// ------------------------------------------------------------------------------

CTestMatLabXRKDlg::CInfoTRACE::CInfoTRACE()
{}
CTestMatLabXRKDlg::CInfoTRACE::~CInfoTRACE()
{}

void CTestMatLabXRKDlg::CInfoTRACE::DoInform(CString const& msg)
{
    m_str.Format(_T("===========> %s\n"), msg.GetString());
    TRACE(m_str);
}

bool GetFilesToOpen(std::list<CString>& names, CString const& folder, bool fileMustExist, TCHAR* szFile, DWORD dimFile, TCHAR* szFileTitle, DWORD dimFileTitle)
{
    CString nomeTmp;
    CString cartellaTmp = folder;

    DWORD dwFlags = OFN_HIDEREADONLY | OFN_EXPLORER | OFN_ENABLESIZING | OFN_ALLOWMULTISELECT;
    if( fileMustExist )
    {
        dwFlags = dwFlags | OFN_FILEMUSTEXIST;
    }

    CString szFilters = _T("XRK Files (*.xrk)|*.xrk|XRZ Files (*.xrz)|*.xrz||");
    CFileDialog dlg( TRUE
        , _T("xrk")
        , _T("*.xrk")
        , dwFlags
        , szFilters.GetString()
        , AfxGetMainWnd()
        , sizeof(OPENFILENAME)
        );

    OPENFILENAME& ofn = dlg.GetOFN();

    ofn.lpstrInitialDir = cartellaTmp.GetString();
    ofn.lpstrFile       = szFile;
    ofn.nMaxFile        = dimFile;
    ofn.lpstrFileTitle  = szFileTitle;
    ofn.nMaxFileTitle   = dimFileTitle;

    if (dlg.DoModal() != IDOK)
        return false;

    POSITION posiz = dlg.GetStartPosition();
    while (posiz != NULL)
    {
        CString nome = dlg.GetNextPathName(posiz);
        if( nome.IsEmpty() ) {
            continue;
        }

        CString lname(nome);
        lname.MakeLower();
        if (lname.Find(_T(".xrk"), lname.GetLength()-4) == lname.GetLength()-4)
        {
            names.push_back(nome);
        }
        else if (lname.Find(_T(".xrz"), lname.GetLength()-4) == lname.GetLength()-4)
        {
            names.push_back(nome);
        }
    }
    return true;
}

#define TOTAL_CYCLES 10

void CTestMatLabXRKDlg::OnBnClickedButtonRunTest()
{
    DWORD dimFile = 1024*1024*2;
    DWORD dimFileTitle = 4096;
    TCHAR* szFile = new TCHAR[dimFile];
    if (!szFile) {
        return;
    }
    TCHAR* szFileTitle = new TCHAR[dimFileTitle];
    if (!szFileTitle)
    {
        delete [] szFile;
        return;
    }
    memset(szFile, 0, dimFile*sizeof(TCHAR));
    memset(szFileTitle, 0, dimFileTitle*sizeof(TCHAR));

    if (m_pInfo)
    {
        delete m_pInfo;
        m_pInfo = NULL;
    }
    m_pInfo = new CInfoTRACE();
    if (!m_pInfo)
    {
        delete [] szFile;
        delete [] szFileTitle;
        return;
    }

    char currentDir[MAX_PATH];
    GetCurrentDirectoryA( MAX_PATH, currentDir );

    std::list<CString> fullpathfiles;
    CString folder(currentDir);
    if (!GetFilesToOpen(fullpathfiles, folder, true, szFile, dimFile, szFileTitle, dimFileTitle))
    {
        delete [] szFile;
        delete [] szFileTitle;
        return;
    }
    
    m_output_info = _T("Stress test started");
    UpdateData(FALSE);

    for (int cycle=0; cycle<TOTAL_CYCLES; ++cycle)
    {
        for (std::list<CString>::iterator it=fullpathfiles.begin(); it!=fullpathfiles.end(); ++it)
        {
#ifdef _UNICODE
            std::wstring Fullpath((*it).GetString());
#else // _UNICODE
            std::string Fullpath((*it).GetString());
#endif // _UNICODE
            //std::string fullpath(Fullpath.begin(), Fullpath.end());
            std::string fullpath;
            for (auto& c : Fullpath) {
                fullpath.push_back((char)c);
            }

            int retval = m_p_func_open_file(fullpath.c_str());
            if (retval > 0)
            {
                CString msg;
                msg.Format(_T("File %s"), (*it).GetString());
                m_pInfo->DoInform(msg);

                m_idx = retval;
                m_fullpath = fullpath;

                int ii=0;

                ii = 0; while (ii++ <  1) { OnBnClickedButtonLapCount();        }
                ii = 0; while (ii++ <  5) { OnBnClickedButtonLapTimes();        }
                ii = 0; while (ii++ <  2) { OnBnClickedButtonVehicle();         }
                ii = 0; while (ii++ <  2) { OnBnClickedButtonTrack();           }
                ii = 0; while (ii++ <  2) { OnBnClickedButtonRacer();           }
                ii = 0; while (ii++ <  2) { OnBnClickedButtonChampionship();    }
                ii = 0; while (ii++ <  2) { OnBnClickedButtonSessionType();     }
                ii = 0; while (ii++ <  2) { OnBnClickedButtonDateTime();        }
                ii = 0; while (ii++ <  1) { OnBnClickedButtonChCount();         }
                ii = 0; while (ii++ <  5) { OnBnClickedButtonChNames();         }
                ii = 0; while (ii++ < 20) { OnBnClickedButtonChData();          }
                ii = 0; while (ii++ < 50) { OnBnClickedButtonLapData();         }
                ii = 0; while (ii++ <  1) { OnBnClickedButtonGPSChCount();      }
                ii = 0; while (ii++ <  5) { OnBnClickedButtonGPSChNames();      }
                ii = 0; while (ii++ < 20) { OnBnClickedButtonGPSChData();       }
                ii = 0; while (ii++ < 50) { OnBnClickedButtonGPSLapData();      }
                ii = 0; while (ii++ <  1) { OnBnClickedButtonGPSRawChCount();   }
                ii = 0; while (ii++ <  5) { OnBnClickedButtonGPSRawChNames();   }
                ii = 0; while (ii++ < 20) { OnBnClickedButtonGPSRawChData();    }
                ii = 0; while (ii++ < 50) { OnBnClickedButtonGPSRawLapData();   }

                m_idx = 0;
                m_fullpath = "";

                m_p_func_close_file_i(retval);
            }
            else {
                AfxMessageBox(_T("Can't open file"));
            }
        }

        m_output_info.Format(_T("Cycle %d on %d completed"), cycle+1, TOTAL_CYCLES);
        UpdateData(FALSE);
    }

    if (m_pInfo)
    {
        delete m_pInfo;
        m_pInfo = NULL;
    }
    m_pInfo = new CInfoMsgBox();
    if (m_pInfo) {
        m_pInfo->DoInform(_T("Stress test completed"));
    }
    delete [] szFile;
    delete [] szFileTitle;
}

void CTestMatLabXRKDlg::OnBnClickedButtonLicence()
{
    m_licence_file = _T("");

    CFileDialog dlg(TRUE
        , NULL
        , NULL
        , OFN_HIDEREADONLY | OFN_EXPLORER | OFN_ENABLESIZING | OFN_FILEMUSTEXIST
        , NULL
        , AfxGetMainWnd()
        , sizeof(OPENFILENAME)
    );

    if (dlg.DoModal() != IDOK)
        return;

    POSITION posiz = dlg.GetStartPosition();
    if (posiz == NULL)
        return;

    m_licence_file = dlg.GetNextPathName(posiz);
}

#pragma warning (pop)
