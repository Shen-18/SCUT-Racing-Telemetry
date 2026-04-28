#ifndef SIMPLEH_H
#define SIMPLEH_H

#include "helper.h"

#ifdef  __cplusplus
extern "C" {
#endif


//! Get the compile date of this library
/*!
\return the compile date
*/
EXPORTED_FUNCTION char const* get_library_date();

//! Get the compile time of this library
/*!
\return the compile time
*/
EXPORTED_FUNCTION char const* get_library_time();

//! Open a xrk file
/*!
\param full_path_name full path to the file to be opened, it cannot be a relative path
\return > 0 in case of success the internal index of the file opened, 0 in case the file is opened but can't be parsed, < 0 in case of problems
*/
EXPORTED_FUNCTION int open_file(char const* full_path_name);

//! Open a xrk file
/*!
\param full_path_name full path to the file to be opened, it cannot be a relative path
\param full_path_licence full path to the licence file, it cannot be a relative path
\return > 0 in case of success the internal index of the file opened, 0 in case the file is opened but can't be parsed, < 0 in case of problems
*/
EXPORTED_FUNCTION int open_file_with_licence(char const* full_path_name, char const* full_path_licence);

//! Get last open error
/*!
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_last_open_error();

//! Close a xrk file
/*!
\param full_path_name full path to the file to be closed, it cannot be a relative path
\return > 0 the internal index of the file closed, < 0 in case of problems
*/
EXPORTED_FUNCTION int close_file_n(char const* full_path_name);

//! Close a xrk file
/*!
\param idxf the internal file index returned by open function
\return > 0 the internal index of the file closed, < 0 in case of problems
*/
EXPORTED_FUNCTION int close_file_i(int idxf);

//! Get Logger ID
/*!
\param idxf the internal file index returned by open function
\return the serial number of the logging unit
*/
EXPORTED_FUNCTION unsigned int get_logger_id(int idxf);

//! Get Number of Devices
/*!
\param idxf the internal file index returned by open function
\return the total number of devices in AiM network (logged excluded)
*/
EXPORTED_FUNCTION int get_number_of_devices(int idxf);

//! Get Device ID
/*!
\param idxf the internal file index returned by open function
\param idxd the index of the device in the network [0, total number)
\return the serial number of the device
*/
EXPORTED_FUNCTION unsigned int get_device_id(int idxf, int idxd);

//! Get vehicle info
/*!
\param idxf the internal file index returned by open function
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_vehicle_name(int idxf);

//! Get track info
/*!
\param idxf the internal file index returned by open function
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_track_name(int idxf);

//! Get racer info
/*!
\param idxf the internal file index returned by open function
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_racer_name(int idxf);

//! Get championship info
/*!
\param idxf the internal file index returned by open function
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_championship_name(int idxf);

//! Get session type info
/*!
\param idxf the internal file index returned by open function
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_session_type_name(int idxf);

//! Get session date and time
/*!
\param idxf the internal file index returned by open function
\return a struct tm pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION struct tm const* get_date_and_time(int idxf);

//! Get laps count of a xrk file
/*!
\param idxf the internal file index returned by open function
\return > 0 the laps count, < 0 in case of problems, 0 in case the xrk file has no laps (theorically not possible)
*/
EXPORTED_FUNCTION int get_laps_count(int idxf);

/*!
    Laps information functions
*/

//! Get lap info
/*!
\param idxf the internal file index returned by open function
\param idxl the lap index
\param pstart pointer to an already allocated double in which the start time of the lap will be stored
\param pduration pointer to an already allocated double in which the lap duration will be stored
\return 1 if all is OK, < 0 in case of problems, 0 in case the xrk file has no laps (theorically not possible)
*/
EXPORTED_FUNCTION int get_lap_info(int idxf, int idxl, double* pstart, double* pduration);

/*!
    session duration information
*/

//! Get session duration
/*!
\param idxf the internal file index returned by open function
\param pduration pointer to an already allocated double in which the lap duration will be stored
\return 1 if all is OK, < 0 in case of problems, 0 in case the xrk file has no laps (theorically not possible)
*/
EXPORTED_FUNCTION int get_session_duration(int idxf, double* pduration);

/*!
    Channels information functions
*/

//! Get channels count of a xrk file
/*!
\param idxf the internal file index returned by open function
\return > 0 the channel count, < 0 in case of problems, 0 in case the xrk file has no channels (theorically not possible)
*/
EXPORTED_FUNCTION int get_channels_count(int idxf);

//! Get channel name
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_channel_name(int idxf, int idxc);
EXPORTED_FUNCTION char const* get_channel_name_no_spaces(int idxf, int idxc);

//! Get channel units
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_channel_units(int idxf, int idxc);

//! Get channel samples count
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\return > 0 the samples count, < 0 in case of problems, 0 in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_channel_samples_count(int idxf, int idxc);

//! Get channel samples
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\param ptimes pointer to an already allocated buffer in which sample times will be stored
\param pvalues pointer to an already allocated buffer in which sample values will be stored
\param cnt the number of samples of the buffer, that is the samples count returned by get channel samples count function
\return > 0 the samples count, < 0 in case of problems, 0 in case the cnt param doesn't match the samples count or in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_channel_samples(int idxf, int idxc, double* ptimes, double* pvalues, int cnt);

//! Get channel samples count in a given lap
/*!
\param idxf the internal file index returned by open function
\param idxl the lap index
\param idxc the channel index
\return > 0 the samples count, < 0 in case of problems, 0 in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_lap_channel_samples_count(int idxf, int idxl, int idxc);

//! Get channel samples in a given lap
/*!
\param idxf the internal file index returned by open function
\param idxl the lap index
\param idxc the channel index
\param ptimes pointer to an already allocated buffer in which sample times will be stored
\param pvalues pointer to an already allocated buffer in which sample values will be stored
\param cnt the number of samples of the buffer, that is the samples count returned by get channel samples count function
\return > 0 the samples count, < 0 in case of problems, 0 in case the cnt param doesn't match the samples count or in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_lap_channel_samples(int idxf, int idxl, int idxc, double* ptimes, double* pvalues, int cnt);

/*!
    GPS channels information functions, where GPS channels are the same channels added to AiM drk files in RS2Analysis,
    those that consider vehicle dynamics assuming that the vehicle is constantly aligned to the trajectory.
*/

//! Set GPS computation frequency, this function must be called before any access to GPS channels.
//! Frequencies allowed are from 1 to 100 Hz. Sampling intervals will be approximated to nearest usec.
/*!
\param freq the frequency you want all computations to be performed
\return 0 if successful, 1 in case of problems (i.e. in case you call this function too late), 2 in case of bad frequency request
*/
EXPORTED_FUNCTION int set_GPS_sample_freq(double freq);

//! Get GPS channels count of a xrk file
/*!
\param idxf the internal file index returned by open function
\return > 0 the channel count, < 0 in case of problems, 0 in case the xrk file has no channels (theorically not possible)
*/
EXPORTED_FUNCTION int get_GPS_channels_count(int idxf);

//! Get GPS channel name
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_GPS_channel_name(int idxf, int idxc);
EXPORTED_FUNCTION char const* get_GPS_channel_name_no_spaces(int idxf, int idxc);

//! Get GPS channel units
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_GPS_channel_units(int idxf, int idxc);

//! Get GPS channel samples count
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\return > 0 the samples count, < 0 in case of problems, 0 in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_GPS_channel_samples_count(int idxf, int idxc);

//! Get GPS channel samples
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\param ptimes pointer to an already allocated buffer in which sample times will be stored
\param pvalues pointer to an already allocated buffer in which sample values will be stored
\param cnt the number of samples of the buffer, that is the samples count returned by get channel samples count function
\return > 0 the samples count, < 0 in case of problems, 0 in case the cnt param doesn't match the samples count or in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_GPS_channel_samples(int idxf, int idxc, double* ptimes, double* pvalues, int cnt);

//! Get GPS channel samples count in a given lap
/*!
\param idxf the internal file index returned by open function
\param idxl the lap index
\param idxc the channel index
\return > 0 the samples count, < 0 in case of problems, 0 in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_lap_GPS_channel_samples_count(int idxf, int idxl, int idxc);

//! Get GPS channel samples in a given lap
/*!
\param idxf the internal file index returned by open function
\param idxl the lap index
\param idxc the channel index
\param ptimes pointer to an already allocated buffer in which sample times will be stored
\param pvalues pointer to an already allocated buffer in which sample values will be stored
\param cnt the number of samples of the buffer, that is the samples count returned by get channel samples count function
\return > 0 the samples count, < 0 in case of problems, 0 in case the cnt param doesn't match the samples count or in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_lap_GPS_channel_samples(int idxf, int idxl, int idxc, double* ptimes, double* pvalues, int cnt);

/*!
    GPS raw channels information functions, where GPS raw channels are information in the GPS solution coming directly from the GPS receiver.
*/

//! Get GPS raw channels count of a xrk file
/*!
\param idxf the internal file index returned by open function
\return > 0 the channel count, < 0 in case of problems, 0 in case the xrk file has no channels (theorically not possible)
*/
EXPORTED_FUNCTION int get_GPS_raw_channels_count(int idxf);

//! Get GPS raw channel name
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_GPS_raw_channel_name(int idxf, int idxc);
EXPORTED_FUNCTION char const* get_GPS_raw_channel_name_no_spaces(int idxf, int idxc);

//! Get GPS raw channel units
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\return a null terminated char pointer with the required info, NULL in case of problems
*/
EXPORTED_FUNCTION char const* get_GPS_raw_channel_units(int idxf, int idxc);

//! Get GPS raw channel samples count
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\return > 0 the samples count, < 0 in case of problems, 0 in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_GPS_raw_channel_samples_count(int idxf, int idxc);

//! Get GPS raw channel samples
/*!
\param idxf the internal file index returned by open function
\param idxc the channel index
\param ptimes pointer to an already allocated buffer in which sample times will be stored
\param pvalues pointer to an already allocated buffer in which sample values will be stored
\param cnt the number of samples of the buffer, that is the samples count returned by get channel samples count function
\return > 0 the samples count, < 0 in case of problems, 0 in case the cnt param doesn't match the samples count or in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_GPS_raw_channel_samples(int idxf, int idxc, double* ptimes, double* pvalues, int cnt);

//! Get GPS raw channel samples count in a given lap
/*!
\param idxf the internal file index returned by open function
\param idxl the lap index
\param idxc the channel index
\return > 0 the samples count, < 0 in case of problems, 0 in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_lap_GPS_raw_channel_samples_count(int idxf, int idxl, int idxc);

//! Get GPS raw channel samples in a given lap
/*!
\param idxf the internal file index returned by open function
\param idxl the lap index
\param idxc the channel index
\param ptimes pointer to an already allocated buffer in which sample times will be stored
\param pvalues pointer to an already allocated buffer in which sample values will be stored
\param cnt the number of samples of the buffer, that is the samples count returned by get channel samples count function
\return > 0 the samples count, < 0 in case of problems, 0 in case the cnt param doesn't match the samples count or in case the channel has no samples (theorically not possible)
*/
EXPORTED_FUNCTION int get_lap_GPS_raw_channel_samples(int idxf, int idxl, int idxc, double* ptimes, double* pvalues, int cnt);

//! Get a text buffer with a summary of the open files
/*!
\return the text buffer
*/
EXPORTED_FUNCTION char const* library_test_on_open_files();

#ifdef  __cplusplus
}
#endif

#endif
