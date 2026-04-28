
#pragma once

#include <string>
#include "resource.h"

extern "C" {
    typedef char const*      ( * func_ptr_get_library_date                      )( );
    typedef char const*      ( * func_ptr_get_library_time                      )( );
    typedef int              ( * func_ptr_open_file                             )( char const* full_path_name );
    typedef int              ( * func_ptr_open_file_with_licence                )( char const* full_path_name, char const* full_path_licence);
    typedef int              ( * func_ptr_close_file_n                          )( char const* full_path_name );
    typedef int              ( * func_ptr_close_file_i                          )( int idx );
    typedef char const*      ( * func_ptr_get_vehicle_name                      )( int idx );
    typedef char const*      ( * func_ptr_get_track_name                        )( int idx );
    typedef char const*      ( * func_ptr_get_racer_name                        )( int idx );
    typedef char const*      ( * func_ptr_get_championship_name                 )( int idx );
    typedef char const*      ( * func_ptr_get_session_type_name                 )( int idx );
    typedef struct tm const* ( * func_ptr_get_date_and_time                     )( int idx );
    typedef int              ( * func_ptr_get_laps_count                        )( int idx );
    typedef int              ( * func_ptr_get_lap_info                          )( int idxf, int idxl, double* pstart, double* pduration );
    typedef int              ( * func_ptr_get_channels_count                    )( int idx );
    typedef char const*      ( * func_ptr_get_channel_name                      )( int idxf, int idxc );
    typedef char const*      ( * func_ptr_get_channel_units                     )( int idxf, int idxc );
    typedef int              ( * func_ptr_get_channel_samples_count             )( int idxf, int idxc );
    typedef int              ( * func_ptr_get_channel_samples                   )( int idxf, int idxc, double* ptime, double* pvalues, int cnt );
    typedef int              ( * func_ptr_get_lap_channel_samples_count         )( int idxf, int idxl, int idxc );
    typedef int              ( * func_ptr_get_lap_channel_samples               )( int idxf, int idxl, int idxc, double* ptime, double* pvalues, int cnt );
    typedef int              ( * func_ptr_get_GPS_channels_count                )( int idx );
    typedef char const*      ( * func_ptr_get_GPS_channel_name                  )( int idxf, int idxc );
    typedef char const*      ( * func_ptr_get_GPS_channel_units                 )( int idxf, int idxc );
    typedef int              ( * func_ptr_get_GPS_channel_samples_count         )( int idxf, int idxc );
    typedef int              ( * func_ptr_get_GPS_channel_samples               )( int idxf, int idxc, double* ptime, double* pvalues, int cnt );
    typedef int              ( * func_ptr_get_lap_GPS_channel_samples_count     )( int idxf, int idxl, int idxc );
    typedef int              ( * func_ptr_get_lap_GPS_channel_samples           )( int idxf, int idxl, int idxc, double* ptime, double* pvalues, int cnt );
    typedef int              ( * func_ptr_get_GPS_raw_channels_count            )( int idx );
    typedef char const*      ( * func_ptr_get_GPS_raw_channel_name              )( int idxf, int idxc );
    typedef char const*      ( * func_ptr_get_GPS_raw_channel_units             )( int idxf, int idxc );
    typedef int              ( * func_ptr_get_GPS_raw_channel_samples_count     )( int idxf, int idxc );
    typedef int              ( * func_ptr_get_GPS_raw_channel_samples           )( int idxf, int idxc, double* ptime, double* pvalues, int cnt );
    typedef int              ( * func_ptr_get_lap_GPS_raw_channel_samples_count )( int idxf, int idxl, int idxc );
    typedef int              ( * func_ptr_get_lap_GPS_raw_channel_samples       )( int idxf, int idxl, int idxc, double* ptime, double* pvalues, int cnt );
    typedef char const*      ( * func_ptr_library_test_on_open_files            )( );
}

class CTestMatLabXRKDlg : public CDialogEx
{
#if (defined(_MSC_VER)) && (_MSC_VER >= 1910)
    CTestMatLabXRKDlg & operator= (const CTestMatLabXRKDlg & other) = delete;
    CTestMatLabXRKDlg(const CTestMatLabXRKDlg & other) = delete;
#endif

    HMODULE m_hdl;
    int m_idx;
    std::string m_fullpath;
    func_ptr_get_library_date                      m_p_func_get_library_date                      ;
    func_ptr_get_library_time                      m_p_func_get_library_time                      ;
    func_ptr_open_file                             m_p_func_open_file                             ;
    func_ptr_open_file_with_licence                m_p_func_open_file_with_licence                ;
    func_ptr_close_file_n                          m_p_func_close_file_n                          ;
    func_ptr_close_file_i                          m_p_func_close_file_i                          ;
    func_ptr_get_vehicle_name                      m_p_func_get_vehicle_name                      ;
    func_ptr_get_track_name                        m_p_func_get_track_name                        ;
    func_ptr_get_racer_name                        m_p_func_get_racer_name                        ;
    func_ptr_get_championship_name                 m_p_func_get_championship_name                 ;
    func_ptr_get_session_type_name                 m_p_func_get_session_type_name                 ;
    func_ptr_get_date_and_time                     m_p_func_get_date_and_time                     ;
    func_ptr_get_laps_count                        m_p_func_get_laps_count                        ;
    func_ptr_get_lap_info                          m_p_func_get_lap_info                          ;
    func_ptr_get_channels_count                    m_p_func_get_channels_count                    ;
    func_ptr_get_channel_name                      m_p_func_get_channel_name                      ;
    func_ptr_get_channel_units                     m_p_func_get_channel_units                     ;
    func_ptr_get_channel_samples_count             m_p_func_get_channel_samples_count             ;
    func_ptr_get_channel_samples                   m_p_func_get_channel_samples                   ;
    func_ptr_get_lap_channel_samples_count         m_p_func_get_lap_channel_samples_count         ;
    func_ptr_get_lap_channel_samples               m_p_func_get_lap_channel_samples               ;
    func_ptr_get_GPS_channels_count                m_p_func_get_GPS_channels_count                ;
    func_ptr_get_GPS_channel_name                  m_p_func_get_GPS_channel_name                  ;
    func_ptr_get_GPS_channel_units                 m_p_func_get_GPS_channel_units                 ;
    func_ptr_get_GPS_channel_samples_count         m_p_func_get_GPS_channel_samples_count         ;
    func_ptr_get_GPS_channel_samples               m_p_func_get_GPS_channel_samples               ;
    func_ptr_get_lap_GPS_channel_samples_count     m_p_func_get_lap_GPS_channel_samples_count     ;
    func_ptr_get_lap_GPS_channel_samples           m_p_func_get_lap_GPS_channel_samples           ;
    func_ptr_get_GPS_raw_channels_count            m_p_func_get_GPS_raw_channels_count            ;
    func_ptr_get_GPS_raw_channel_name              m_p_func_get_GPS_raw_channel_name              ;
    func_ptr_get_GPS_raw_channel_units             m_p_func_get_GPS_raw_channel_units             ;
    func_ptr_get_GPS_raw_channel_samples_count     m_p_func_get_GPS_raw_channel_samples_count     ;
    func_ptr_get_GPS_raw_channel_samples           m_p_func_get_GPS_raw_channel_samples           ;
    func_ptr_get_lap_GPS_raw_channel_samples_count m_p_func_get_lap_GPS_raw_channel_samples_count ;
    func_ptr_get_lap_GPS_raw_channel_samples       m_p_func_get_lap_GPS_raw_channel_samples       ;
    func_ptr_library_test_on_open_files            m_p_func_library_test_on_open_files            ;

public:
    CTestMatLabXRKDlg(CWnd* pParent = NULL);
    virtual ~CTestMatLabXRKDlg();

    enum { IDD = IDD_TESTMATLABXRK_DIALOG };

protected:
    virtual void DoDataExchange(CDataExchange* pDX);

protected:
    HICON m_hIcon;

    virtual BOOL OnInitDialog();
    afx_msg void OnSysCommand(UINT nID, LPARAM lParam);
    afx_msg void OnPaint();
    afx_msg HCURSOR OnQueryDragIcon();

    DECLARE_MESSAGE_MAP()

public:
    void Free();
    afx_msg void OnClose();
    virtual void OnCancel();
    afx_msg void OnBnClickedButtonDllVersion();
    afx_msg void OnBnClickedButtonLicence();
    afx_msg void OnBnClickedButtonOpen();
    afx_msg void OnBnClickedButtonClose();
    afx_msg void OnBnClickedButtonVehicle();
    afx_msg void OnBnClickedButtonTrack();
    afx_msg void OnBnClickedButtonRacer();
    afx_msg void OnBnClickedButtonChampionship();
    afx_msg void OnBnClickedButtonSessionType();
    afx_msg void OnBnClickedButtonDateTime();
    afx_msg void OnBnClickedButtonLapCount();
    afx_msg void OnBnClickedButtonLapTimes();
    afx_msg void OnBnClickedButtonChCount();
    afx_msg void OnBnClickedButtonChNames();
    afx_msg void OnBnClickedButtonChData();
    afx_msg void OnBnClickedButtonLapData();
    afx_msg void OnBnClickedButtonGPSChCount();
    afx_msg void OnBnClickedButtonGPSChNames();
    afx_msg void OnBnClickedButtonGPSChData();
    afx_msg void OnBnClickedButtonGPSLapData();
    afx_msg void OnBnClickedButtonGPSRawChCount();
    afx_msg void OnBnClickedButtonGPSRawChNames();
    afx_msg void OnBnClickedButtonGPSRawChData();
    afx_msg void OnBnClickedButtonGPSRawLapData();

private:

    class CInfo
    {
    public:
        CInfo();
        virtual ~CInfo();

        virtual void DoInform(CString const& msg) = 0;
    };

    class CInfoMsgBox : public CInfo
    {
    public:
        CInfoMsgBox();
        virtual ~CInfoMsgBox();

        void DoInform(CString const& msg);
    };

    class CInfoTRACE : public CInfo
    {
        CString m_str;
    public:
        CInfoTRACE();
        virtual ~CInfoTRACE();

        void DoInform(CString const& msg);
    };

    CInfo* m_pInfo;

public:
    afx_msg void OnBnClickedButtonRunTest();
    afx_msg void OnBnClickedButtonLibTest();
    afx_msg void OnBnClickedButtonCsv();

private:
    CString m_licence_file;
    CString m_output_info;
    bool m_b_clicked_gps_chan_cnt;
    bool m_b_clicked_gps_raw_chan_cnt;
};
