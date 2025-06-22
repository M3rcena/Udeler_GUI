const electron = require("electron");
const remote = electron.remote;
const dialog = remote.dialog;
const BrowserWindow = remote.BrowserWindow;
const fs = require("fs");
const prompt = require("dialogs")((opts = {}));
const mkdirp = require("mkdirp");
const homedir = require("os").homedir();
const sanitize = require("sanitize-filename");
const vtt2srt = require("node-vtt-to-srt");
var Downloader = require("mt-files-downloader");
var shell = require("electron").shell;
var https = require("https");
var app = require("http").createServer();
var io = require("socket.io")(app);
var headers;
const $loginAuthenticator = $(".ui.login.authenticator");

var awaitingLogin = false;

app.listen(50490);

io.on("connect", function (socket) {
  $loginAuthenticator.removeClass("disabled");

  socket.on("disconnect", function () {
    $loginAuthenticator.addClass("disabled");
    $(".ui.authenticator.dimmer").removeClass("active");
    awaitingLogin = false;
  });

  $loginAuthenticator.click(function () {
    $(".ui.authenticator.dimmer").addClass("active");
    awaitingLogin = true;
    socket.emit("awaitingLogin");
  });

  socket.on("newLogin", function (data) {
    if (awaitingLogin) {
      settings.set("access_token", data.access_token);
      settings.set("subdomain", data.subdomain);
      checkLogin();
    }
  });
});

let loginWindow = null;

electron.ipcRenderer.on("access-token", function (event, data) {
  if (loginWindow) {
    settings.set("access_token", data.access_token);
    settings.set("subdomain", data.subdomain);
    checkLogin();
    loginWindow.close();
  }
});

electron.ipcRenderer.on("saveDownloads", function () {
  saveDownloads(true);
});

var subDomain = settings.get("subdomain") || "www";

var $subDomain = $(".ui.login #subdomain");

$(".ui.dropdown").dropdown();

$(document).ajaxError(function (event, request) {
  $(".dimmer").removeClass("active");
});

var downloadTemplate = `
<div class="action buttons">
  <button class="ui download button"><i class="download icon"></i><span>${translate("Download")}</span></button>
  <button class="ui basic yellow browser button open-in-browser"><i class="desktop icon"></i><span>${translate("View")}</span></button>
</div>
<div class="ui tiny indicating individual progress" style="display: none;">
   <div class="bar"></div>
</div>
<div class="ui small indicating combined progress" style="display: none;">
  <div class="bar">
    <div class="progress"></div>
  </div>
<div class="label">${translate("Building Course Data")}</div>
</div>
`;

$(".ui.login #business").change(function () {
  if ($(this).is(":checked")) {
    $subDomain.show();
  } else {
    $subDomain.hide();
  }
});

checkLogin();

$(".main-content").on("click", ".download-success", function () {
  $(this).hide();
  $(this)
    .parents(".course")
    .find(".download-status")
    .show();
});

$(".main-content").on("click", ".open-in-browser", function () {
  const link = `https://www.udemy.com${$(this).parents(".course.item").attr('course-url')}`;
  shell.openExternal(link);
});


$(".main-content").on("click", ".load-more.button", function () {
  var $this = $(this);
  var $courses = $this.prev(".courses.items");
  $.ajax({
    type: "GET",
    url: $this.data("url"),
    beforeSend: function () {
      $(".ui.dashboard .courses.dimmer").addClass("active");
    },
    headers: headers,
    success: function (response) {
      $(".ui.dashboard .courses.dimmer").removeClass("active");
      $.each(response.results, function (index, course) {
        $(`<div class="ui course item" course-id="${course.id}" course-url="${course.url}">
                                <div class="ui tiny label download-quality grey"></div>
                                <div class="ui tiny grey label download-speed"><span class="value">0</span> KB/s</div>
                                  <div class="ui tiny image">
                                    <img src="${course.image_240x135}">
                                  </div>
                                  <div class="content">
                <span class="coursename">${course.title}</span>

              <div class="ui tiny icon green download-success message" style="display: none;">
                                         <i class="check icon"></i>
                                          <div class="content">
                        <div class="header">
                           ${translate("Download Completed")}
                                             </div>
                         <p>${translate("Click to dismiss")}</p>
                                           </div>
                                    </div>

              <div class="ui tiny icon red download-error message" style="display: none;">
                     <i class="power off icon"></i>
                                          <div class="content">
                        <div class="header">
                                               ${translate("Download Failed")}
                                             </div>
                         <p>${translate("Click to retry")}</p>
                                           </div>
                                    </div>

                                    <div class="extra download-status">
                                      ${downloadTemplate}
                                    </div>

                                  </div>
                                </div>
                        `).appendTo($courses);
      });
      if (!response.next) {
        $this.remove();
      } else {
        $this.data("url", response.next);
      }
    }
  });
});

$(".main-content").on("click", ".check-updates", function () {
  $(".ui.dashboard .about.dimmer").addClass("active");
  $.getJSON(
    "https://api.github.com/repos/FaisalUmair/udemy-downloader-gui/releases/latest",
    function (response) {
      $(".ui.dashboard .about.dimmer").removeClass("active");
      if (response.tag_name != `v${appVersion}`) {
        $(".ui.update-available.modal").modal("show");
      } else {
        prompt.alert(translate("No updates available"));
      }
    }
  );
});

$(".main-content").on("click", ".refresh-courses", function () {
  refreshCourses();
});

function refreshCourses() {
  $(".ui.dashboard .courses.dimmer").addClass("active");
  $(".ui.courses.items").empty();

  $.ajax({
    type: "GET",
    url: `https://${settings.get("subdomain")}.udemy.com/api-2.0/users/me/subscribed-courses?page_size=50`,
    headers: headers,
    success: function (response) {
      $(".ui.dashboard .courses.dimmer").removeClass("active");
      handleResponse(response);
    },
    error: function (response) {
      $(".ui.dashboard .courses.dimmer").removeClass("active");
      if (response.status == 403 || response.status == 401) {
        prompt.alert(translate("Invalid Access Token"));
        settings.set("access_token", false);
        resetToLogin();
      } else {
        prompt.alert(translate("Failed to refresh courses"));
      }
    }
  });
}

$(".main-content .courses.section .search.form").submit(function (e) {
  e.preventDefault();
  var keyword = $(e.target)
    .find("input")
    .val();
  if (validURL(keyword)) {
    if (keyword.search(new RegExp("^(http|https)"))) {
      keyword = "http://" + keyword;
    }
    $.ajax({
      type: "GET",
      url: keyword,
      beforeSend: function () {
        $(".ui.dashboard .course.dimmer").addClass("active");
      },
      headers: headers,
      success: function (response) {
        $(".ui.dashboard .course.dimmer").removeClass("active");
        var keyword = $(".main-content h1.clp-lead__title", response)
          .text()
          .trim();
        if (typeof keyword != "undefined" && keyword != "") {
          search(keyword, headers);
        } else {
          $(".ui.dashboard .courses.dimmer").removeClass("active");
          $(".ui.dashboard .ui.courses.section .disposable").remove();
          $(".ui.dashboard .ui.courses.section .ui.courses.items").empty();
          $(".ui.dashboard .ui.courses.section .ui.courses.items").append(
            `<div class="ui yellow message disposable">${translate(
              "No Courses Found"
            )}</div>`
          );
        }
      },
      error: function () {
        $(".ui.dashboard .courses.dimmer").removeClass("active");
        $(".ui.dashboard .ui.courses.section .disposable").remove();
        $(".ui.dashboard .ui.courses.section .ui.courses.items").empty();
        $(".ui.dashboard .ui.courses.section .ui.courses.items").append(
          `<div class="ui yellow message disposable">${translate(
            "No Courses Found"
          )}</div>`
        );
      }
    });
  } else {
    search(keyword, headers);
  }
});

$('.main-content').on('click', '.course-item .download.button', function () {
  const courseItem = $(this).closest('.course-item');
  const course = {
    id: courseItem.attr('course-id'),
    title: courseItem.find('.coursename').text()
  };
  showVideoPopup(course);
});

const getCourseLectures = (courseId) => {
  return new Promise((resolve, reject) => {
    const apiUrl = `https://${settings.get("subdomain") || 'www'}.udemy.com/api-2.0/courses/${courseId}/subscriber-curriculum-items/?curriculum_types=chapter,lecture,practice,quiz,role-play&page_size=200&fields[lecture]=title,object_index,is_published,sort_order,created,asset,supplementary_assets,is_free&fields[quiz]=title,object_index,is_published,sort_order,type&fields[practice]=title,object_index,is_published,sort_order&fields[chapter]=title,object_index,is_published,sort_order&fields[asset]=title,filename,asset_type,status,time_estimation,is_external,course_is_drmed,media_sources,download_urls&caching_intent=True`;

    $.ajax({
      url: apiUrl,
      type: 'GET',
      headers: headers,
      success: function (response) {
        // Sort all items by sort_order (descending to get proper order)
        const sortedItems = response.results.sort((a, b) => b.sort_order - a.sort_order);

        const chapters = [];
        let currentChapter = null;

        sortedItems.forEach(item => {
          if (item._class === 'chapter') {
            // Start a new chapter
            currentChapter = {
              id: item.id,
              title: item.title,
              sort_order: item.sort_order,
              items: []
            };
            chapters.push(currentChapter);
          } else if (currentChapter && (item._class === 'lecture' || item._class === 'quiz' || item._class === 'practice')) {
            // Add item to current chapter
            const itemData = {
              id: item.id,
              title: item.title,
              sort_order: item.sort_order,
              object_index: item.object_index,
              is_free: item.is_free || false,
              _class: item._class
            };

            // Add asset information if available
            if (item.asset) {
              itemData.asset = item.asset;
              itemData.asset_type = item.asset.asset_type;
              itemData.time_estimation = item.asset.time_estimation;
            }

            // Add quiz type if it's a quiz
            if (item._class === 'quiz') {
              itemData.quiz_type = item.type;
            }

            currentChapter.items.push(itemData);
          }
        });

        // Sort items within each chapter by object_index
        chapters.forEach(chapter => {
          chapter.items.sort((a, b) => a.object_index - b.object_index);
        });

        resolve(chapters);
      },
      error: function (err) {
        console.error('Error fetching course lectures:', err);
        reject(err);
      }
    });
  });
};

const showVideoPopup = (course) => {
  getCourseLectures(course.id).then(chapters => {
    const videoList = $('#video-list');
    videoList.empty();

    // Add header with course title and download all button
    const headerContent = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <span style="flex: 1; margin-right: 20px;">${course.title}</span>
        <button class="ui button download-all-btn" style="background-color: #00ffff; color: #000000; border: none; border-radius: 8px; padding: 8px 16px; font-size: 0.9em; font-weight: 600; margin-right: 50px;">
          <i class="download icon"></i>
          Download All
        </button>
      </div>
    `;
    $('.ui.modal.video-list-popup .header').html(headerContent);

    if (chapters && chapters.length > 0) {
      chapters.forEach(chapter => {
        // Add chapter header
        const chapterHeader = $(`<div class="chapter-header"><h4 style="color: #00ffff; margin: 20px 0 10px 0;">${chapter.title}</h4></div>`);
        videoList.append(chapterHeader);

        if (chapter.items && chapter.items.length > 0) {
          chapter.items.forEach((item, index) => {
            const safeCourseTitle = course.title.replace(/"/g, '&quot;');
            const safeItemTitle = item.title.replace(/"/g, '&quot;');
            const safeSectionTitle = chapter.title.replace(/"/g, '&quot;');

            let icon = 'file video icon';
            let actionButton = '';
            let timeInfo = '';

            // Add time estimation if available
            if (item.time_estimation) {
              const minutes = Math.ceil(item.time_estimation / 60);
              timeInfo = ` <span style="color: #888; font-size: 0.9em;">(${minutes} min)</span>`;
            }

            // Add free indicator
            const freeIndicator = item.is_free ? ' <span style="color: #4CAF50; font-size: 0.8em;">(FREE)</span>' : '';

            // Determine icon and action based on content type
            let fileExtension = '.mp4';
            switch (item._class) {
              case 'lecture':
                switch (item.asset_type) {
                  case 'Video':
                    icon = 'file video icon';
                    fileExtension = '.mp4';
                    // Check for DRM protection
                    if (item.asset && (item.asset.course_is_drmed === true || (item.asset.media_sources && item.asset.media_sources.length > 0 && !item.asset.download_urls))) {
                      actionButton = `<button class="ui button mini grey disabled">DRM Protected</button>`;
                    } else {
                      actionButton = `<button class="ui button mini download-video-btn" data-course-id="${course.id}" data-course-title="${safeCourseTitle}" data-section-title="${safeSectionTitle}" data-lecture-id="${item.id}" data-lecture-title="${safeItemTitle}" data-file-extension="${fileExtension}">Download</button>`;
                    }
                    break;
                  case 'Article':
                    icon = 'file text icon';
                    actionButton = `<button class="ui button mini download-article-btn" data-course-id="${course.id}" data-course-title="${safeCourseTitle}" data-section-title="${safeSectionTitle}" data-lecture-id="${item.id}" data-lecture-title="${safeItemTitle}">Download Article</button>`;
                    break;
                  case 'File':
                    icon = 'file icon';
                    fileExtension = item.asset && item.asset.filename ? '.' + item.asset.filename.split('.').pop() : '.pdf';
                    actionButton = `<button class="ui button mini download-file-btn" data-course-id="${course.id}" data-course-title="${safeCourseTitle}" data-section-title="${safeSectionTitle}" data-lecture-id="${item.id}" data-lecture-title="${safeItemTitle}" data-file-extension="${fileExtension}">Download</button>`;
                    break;
                  case 'E-Book':
                    icon = 'book icon';
                    fileExtension = item.asset && item.asset.filename ? '.' + item.asset.filename.split('.').pop() : '.pdf';
                    actionButton = `<button class="ui button mini download-ebook-btn" data-course-id="${course.id}" data-course-title="${safeCourseTitle}" data-section-title="${safeSectionTitle}" data-lecture-id="${item.id}" data-lecture-title="${safeItemTitle}" data-file-extension="${fileExtension}">Download</button>`;
                    break;
                  case 'Audio':
                    icon = 'volume up icon';
                    fileExtension = item.asset && item.asset.filename ? '.' + item.asset.filename.split('.').pop() : '.mp3';
                    actionButton = `<button class="ui button mini download-audio-btn" data-course-id="${course.id}" data-course-title="${safeCourseTitle}" data-section-title="${safeSectionTitle}" data-lecture-id="${item.id}" data-lecture-title="${safeItemTitle}" data-file-extension="${fileExtension}">Download</button>`;
                    break;
                  default:
                    icon = 'file icon';
                    actionButton = `<button class="ui button mini view-content-btn" data-course-id="${course.id}" data-lecture-id="${item.id}" data-lecture-title="${safeItemTitle}">View</button>`;
                }
                break;
              case 'quiz':
                icon = 'question circle icon';
                actionButton = `<button class="ui button mini view-quiz-btn" data-course-id="${course.id}" data-lecture-id="${item.id}" data-lecture-title="${safeItemTitle}">Take Quiz</button>`;
                break;
              case 'practice':
                icon = 'code icon';
                actionButton = `<button class="ui button mini view-practice-btn" data-course-id="${course.id}" data-lecture-id="${item.id}" data-lecture-title="${safeItemTitle}">Practice</button>`;
                break;
              default:
                icon = 'file icon';
                actionButton = `<button class="ui button mini view-content-btn" data-course-id="${course.id}" data-lecture-id="${item.id}" data-lecture-title="${safeItemTitle}">View</button>`;
            }

            const itemElement = `
                            <div class="video-item">
                                <span><i class="${icon}"></i> ${item.title}${timeInfo}${freeIndicator}</span>
                                ${actionButton}
                            </div>`;
            videoList.append(itemElement);
          });
        } else {
          videoList.append('<p style="margin-left: 20px; color: #888;">No content in this section.</p>');
        }
      });

      // Check download status for all downloadable items
      setTimeout(() => {
        $('.download-video-btn, .download-file-btn, .download-ebook-btn, .download-audio-btn, .download-article-btn').each(function () {
          const button = $(this);
          const courseId = button.data('course-id');
          const courseTitle = button.data('course-title');
          const sectionTitle = button.data('section-title');
          const lectureId = button.data('lecture-id');
          const lectureTitle = button.data('lecture-title');
          const fileExtension = button.data('file-extension') || '.html';

          electron.ipcRenderer.send('check-download-status', {
            lectureId: lectureId,
            courseTitle: courseTitle,
            lectureTitle: lectureTitle,
            sectionName: sectionTitle,
            fileExtension: fileExtension
          });
        });
      }, 100);

    } else {
      videoList.append('<p>No content found for this course.</p>');
    }

    $('.ui.modal.video-list-popup').modal('show');

    // Add event handler for when modal is hidden
    $('.ui.modal.video-list-popup').on('hidden', function () {
      cleanupModalDimmers();
      // Force cleanup after modal is hidden
      setTimeout(function () {
        cleanupModalDimmers();
        $('.ui.dimmer').removeClass('active visible').hide();
        $('.ui.page.dimmer').removeClass('active visible').hide();
        $('.ui.modals.dimmer').removeClass('active visible').hide();
      }, 50);
    });
  }).catch(error => {
    showToast('Could not load course content.', 'error');
  });
};

$(document).on('click', '.download-video-btn', function () {
  const button = $(this);
  button.text('Starting...').prop('disabled', true);

  const courseId = button.data('course-id');
  const lectureId = button.data('lecture-id');
  const courseTitle = button.data('course-title');
  const lectureTitle = button.data('lecture-title');
  const sectionTitle = button.data('section-title');
  const fileExtension = button.data('file-extension');

  console.log('Starting download for:', {
    courseId,
    lectureId,
    courseTitle,
    lectureTitle,
    sectionTitle,
    fileExtension
  });

  // First, check if this video is actually downloadable and not DRM protected
  const checkApiUrl = `https://${settings.get("subdomain") || 'www'}.udemy.com/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?fields[lecture]=asset&fields[asset]=asset_type,status,is_external,download_urls,stream_urls,external_url,course_is_drmed,media_sources`;

  $.ajax({
    url: checkApiUrl,
    type: 'GET',
    headers: headers,
    success: function (response) {
      console.log('Video check response:', response);

      if (!response.asset) {
        showToast('Video asset not found or not accessible.', 'error');
        button.text('Download').prop('disabled', false);
        return;
      }

      // Check for DRM protection
      if (response.asset.course_is_drmed === true || (response.asset.media_sources && response.asset.media_sources.length > 0 && !response.asset.download_urls)) {
        console.error('Video is DRM protected and cannot be downloaded.');
        showToast('This video is DRM protected and cannot be downloaded.', 'error');
        button.text('DRM Protected').addClass('grey').prop('disabled', true);
        return;
      }

      // Check if video is external (might not be downloadable)
      if (response.asset.is_external) {
        showToast('This is an external video and may not be downloadable.', 'error');
        button.text('Download').prop('disabled', false);
        return;
      }

      // Check if video has a status that indicates it's not available
      if (response.asset.status !== undefined && response.asset.status !== null) {
        // Status codes: 1 = ready, 0 = not ready, other values = various states
        if (response.asset.status !== 1) {
          const statusMessages = {
            0: 'Video is not ready for download',
            2: 'Video is being processed',
            3: 'Video processing failed',
            4: 'Video is temporarily unavailable'
          };
          const statusMessage = statusMessages[response.asset.status] || `Video status: ${response.asset.status}`;
          showToast(`${statusMessage}.`, 'error');
          button.text('Download').prop('disabled', false);
          return;
        }
      }

      // If we get here, try to get the download URL
      getLectureDownloadUrl(courseId, lectureId).then(downloadUrl => {
        if (downloadUrl) {
          console.log('Got download URL, starting download:', downloadUrl);
          electron.ipcRenderer.send('download-video', {
            url: downloadUrl,
            courseTitle: courseTitle,
            lectureTitle: lectureTitle,
            lectureId: lectureId,
            sectionName: sectionTitle,
            fileExtension: fileExtension
          });
          showToast('Download started.');
        } else {
          console.error('No download URL returned for lecture:', lectureId);
          showToast('Could not get download URL. This video may not be available for download.', 'error');
          button.text('Download').prop('disabled', false);
        }
      }).catch(err => {
        console.error('Error in download process for lecture:', lectureId, err);

        let errorMessage = 'Failed to get download URL.';

        if (err.status === 403 || err.status === 401) {
          errorMessage = 'Access denied. Please check your login credentials.';
        } else if (err.status === 404) {
          errorMessage = 'Video not found. It may have been removed or is not available.';
        } else if (err.status >= 500) {
          errorMessage = 'Server error. Please try again later.';
        } else if (err.responseText) {
          errorMessage = `Download failed: ${err.responseText}`;
        }

        showToast(errorMessage, 'error');
        button.text('Download').prop('disabled', false);
      });
    },
    error: function (err) {
      console.error('Error checking video availability:', err);
      showToast('Failed to check video availability.', 'error');
      button.text('Download').prop('disabled', false);
    }
  });
});

$(document).on('click', '.download-file-btn, .download-ebook-btn, .download-audio-btn', function () {
  const button = $(this);
  const courseId = button.data('course-id');
  const courseTitle = button.data('course-title');
  const sectionTitle = button.data('section-title');
  const lectureId = button.data('lecture-id');
  const lectureTitle = button.data('lecture-title');
  const fileExtension = button.data('file-extension');

  button.text('Starting...').prop('disabled', true);

  // Get file download URL
  const apiUrl = `https://${settings.get("subdomain") || 'www'}.udemy.com/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?fields[lecture]=asset&fields[asset]=@min,download_urls,filename`;

  $.ajax({
    url: apiUrl,
    type: 'GET',
    headers: headers,
    success: function (response) {
      if (response.asset && response.asset.download_urls) {
        // Find the appropriate download URL based on asset type
        let downloadUrl = null;

        if (response.asset.download_urls.File && response.asset.download_urls.File.length > 0) {
          downloadUrl = response.asset.download_urls.File[0].file;
        } else if (response.asset.download_urls['E-Book'] && response.asset.download_urls['E-Book'].length > 0) {
          downloadUrl = response.asset.download_urls['E-Book'][0].file;
        } else if (response.asset.download_urls.Audio && response.asset.download_urls.Audio.length > 0) {
          downloadUrl = response.asset.download_urls.Audio[0].file;
        }

        if (downloadUrl) {
          electron.ipcRenderer.send('download-video', {
            url: downloadUrl,
            courseTitle: courseTitle,
            lectureTitle: lectureTitle,
            lectureId: lectureId,
            sectionName: sectionTitle,
            fileExtension: fileExtension
          });
          showToast('Download started.');
        } else {
          showToast('No download URL available for this file.', 'error');
          button.text('Download').prop('disabled', false);
        }
      } else {
        showToast('No download URL available for this file.', 'error');
        button.text('Download').prop('disabled', false);
      }
    },
    error: function (err) {
      showToast('Failed to get download URL.', 'error');
      button.text('Download').prop('disabled', false);
    }
  });
});

$(document).on('click', '.download-article-btn', function () {
  const button = $(this);
  const courseId = button.data('course-id');
  const lectureId = button.data('lecture-id');
  const lectureTitle = button.data('lecture-title');
  const courseTitle = button.data('course-title');
  const sectionTitle = button.data('section-title');

  button.text('Downloading...').prop('disabled', true);

  // Fetch article content using the correct API endpoint
  const apiUrl = `https://${settings.get("subdomain") || 'www'}.udemy.com/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?fields[lecture]=asset&fields[asset]=@min,asset_type,body,external_url,download_urls`;

  $.ajax({
    url: apiUrl,
    type: 'GET',
    headers: headers,
    success: function (response) {
      if (response.asset && response.asset.body) {
        // Create a complete HTML document with the article content
        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${lectureTitle}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .article-container {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007bff;
            padding-bottom: 10px;
        }
        img {
            max-width: 100%;
            height: auto;
        }
        a {
            color: #007bff;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        pre {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
        }
        code {
            background-color: #f8f9fa;
            padding: 2px 4px;
            border-radius: 3px;
        }
        blockquote {
            border-left: 4px solid #007bff;
            margin: 0;
            padding-left: 20px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="article-container">
        <h1>${lectureTitle}</h1>
        <div class="article-content">
            ${response.asset.body}
        </div>
    </div>
</body>
</html>`;

        // Send HTML content directly to main process
        electron.ipcRenderer.send('download-html-content', {
          htmlContent: htmlContent,
          courseTitle: courseTitle || 'Unknown Course',
          lectureTitle: lectureTitle,
          lectureId: lectureId,
          sectionName: sectionTitle || 'Uncategorized'
        });

        showToast('Article download started.');
      } else {
        showToast('No content available for this article.', 'error');
      }
      button.text('Download Article').prop('disabled', false);
    },
    error: function (err) {
      console.error('Article download error:', err);
      showToast('Failed to load article content.', 'error');
      button.text('Download Article').prop('disabled', false);
    }
  });
});

$(document).on('click', '.view-content-btn', function () {
  const button = $(this);
  const courseId = button.data('course-id');
  const lectureId = button.data('lecture-id');
  const lectureTitle = button.data('lecture-title');

  button.text('Loading...').prop('disabled', true);

  // Try to get content details
  const apiUrl = `https://${settings.get("subdomain") || 'www'}.udemy.com/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?fields[lecture]=asset&fields[asset]=@min,asset_type,body,external_url,download_urls`;

  $.ajax({
    url: apiUrl,
    type: 'GET',
    headers: headers,
    success: function (response) {
      if (response.asset) {
        let content = '';
        if (response.asset.body) {
          content = response.asset.body;
        } else if (response.asset.external_url) {
          content = `<p>External content available at: <a href="${response.asset.external_url}" target="_blank">${response.asset.external_url}</a></p>`;
        } else {
          content = '<p>No content available for this item.</p>';
        }

        const contentModal = $(`
          <div class="ui large content modal">
            <i class="close icon"></i>
            <div class="header">${lectureTitle}</div>
            <div class="scrolling content">
              <div class="content-body">${content}</div>
            </div>
          </div>
        `);

        $('body').append(contentModal);
        contentModal.modal('show');

        contentModal.modal({
          onHide: function () {
            cleanupModalDimmers();
            // Remove modal from DOM
            contentModal.remove();
          }
        });
      } else {
        showToast('No content available.', 'error');
      }
      button.text('View').prop('disabled', false);
    },
    error: function (err) {
      showToast('Failed to load content.', 'error');
      button.text('View').prop('disabled', false);
    }
  });
});

$(document).on('click', '.view-quiz-btn', function () {
  const button = $(this);
  const courseId = button.data('course-id');
  const lectureId = button.data('lecture-id');
  const lectureTitle = button.data('lecture-title');

  // Get the course URL to extract the slug
  const courseItem = button.closest('.course-item');
  const courseUrl = courseItem.attr('course-url');

  // Extract course slug from course URL (e.g., "/course/web-design-secrets/" -> "web-design-secrets")
  let courseSlug = courseId; // fallback to course ID
  if (courseUrl) {
    const slugMatch = courseUrl.match(/\/course\/([^\/]+)/);
    if (slugMatch) {
      courseSlug = slugMatch[1];
    }
  }

  button.text('Opening...').prop('disabled', true);

  // Open quiz in system's default browser with correct URL format
  const quizUrl = `https://www.udemy.com/course/${courseSlug}/learn/quiz/${lectureId}#overview`;

  // Use electron.shell to open in system's default browser
  electron.ipcRenderer.send('open-external-url', quizUrl);

  showToast('Opening quiz in your default browser...');
  button.text('Take Quiz').prop('disabled', false);
});

$(document).on('click', '.view-practice-btn', function () {
  const button = $(this);
  const courseId = button.data('course-id');
  const lectureId = button.data('lecture-id');
  const lectureTitle = button.data('lecture-title');

  // Get the course URL to extract the slug
  const courseItem = button.closest('.course-item');
  const courseUrl = courseItem.attr('course-url');

  // Extract course slug from course URL (e.g., "/course/web-design-secrets/" -> "web-design-secrets")
  let courseSlug = courseId; // fallback to course ID
  if (courseUrl) {
    const slugMatch = courseUrl.match(/\/course\/([^\/]+)/);
    if (slugMatch) {
      courseSlug = slugMatch[1];
    }
  }

  button.text('Opening...').prop('disabled', true);

  // Open practice exercise in system's default browser with correct URL format
  const practiceUrl = `https://www.udemy.com/course/${courseSlug}/learn/practice/${lectureId}#overview`;

  // Use electron.shell to open in system's default browser
  electron.ipcRenderer.send('open-external-url', practiceUrl);

  showToast('Opening practice exercise in your default browser...');
  button.text('Practice').prop('disabled', false);
});

electron.ipcRenderer.on('download-status-result', (event, { lectureId, isDownloaded, filePath }) => {
  const button = $(`.download-video-btn[data-lecture-id="${lectureId}"], .download-file-btn[data-lecture-id="${lectureId}"], .download-ebook-btn[data-lecture-id="${lectureId}"], .download-audio-btn[data-lecture-id="${lectureId}"], .download-article-btn[data-lecture-id="${lectureId}"]`);

  if (button.length && isDownloaded) {
    button.removeClass('download-video-btn download-file-btn download-ebook-btn download-audio-btn download-article-btn')
      .addClass('open-file-btn')
      .text('Open File')
      .addClass('green')
      .prop('disabled', false)
      .data('file-path', filePath);
  }
});

electron.ipcRenderer.on('download-progress', (event, {
  lectureId,
  progress
}) => {
  const button = $(`.download-video-btn[data-lecture-id="${lectureId}"]`);
  if (button.length) {
    button.text(`${Math.floor(progress.percent * 100)}%`);
  }
});

electron.ipcRenderer.on('download-complete', (event, {
  lectureId,
  error
}) => {
  const button = $(`.download-video-btn[data-lecture-id="${lectureId}"], .download-article-btn[data-lecture-id="${lectureId}"]`);
  if (button.length) {
    if (error) {
      button.text('Failed').addClass('red');
    } else {
      button.text('Completed').addClass('green').prop('disabled', true);
      // Update to "Open File" after a short delay
      setTimeout(() => {
        button.removeClass('download-video-btn download-article-btn')
          .addClass('open-file-btn')
          .text('Open File')
          .prop('disabled', false);
      }, 2000);
    }
  }
});

$(".courses-sidebar").click(function () {
  $(".main-content .ui.section").hide();
  $(".main-content .ui.courses.section").show();
  $(this)
    .parent(".bottom-nav")
    .find(".active")
    .removeClass("active");
  $(this).addClass("active");
});

$(".downloads-sidebar").click(function () {
  $(".ui.dashboard .downloads.dimmer").addClass("active");
  $(".main-content .ui.section").hide();
  $(".main-content .ui.downloads.section").show();
  $(this)
    .parent(".bottom-nav")
    .find(".active")
    .removeClass("active");
  $(this).addClass("active");
  loadDownloads();
});

$(".settings-sidebar").click(function () {
  $(".main-content .ui.section").hide();
  $(".main-content .ui.settings.section").show();
  $(this)
    .parent(".bottom-nav")
    .find(".active")
    .removeClass("active");
  $(this).addClass("active");
  loadSettings();
});

$(".about-sidebar").click(function () {
  $(".main-content .ui.section").hide();
  $(".main-content .ui.about.section").css('display', 'flex');
  $(this)
    .parent(".bottom-nav")
    .find(".active")
    .removeClass("active");
  $(this).addClass("active");
});

$(".logout-sidebar").click(function () {
  prompt.confirm("Confirm Log Out?", function (ok) {
    if (ok) {
      $(".ui.logout.dimmer").addClass("active");
      saveDownloads(false);
      settings.set("access_token", false);
      resetToLogin();
    }
  });
});

$(".download-update.button").click(function () {
  shell.openExternal(
    "https://github.com/FaisalUmair/udemy-downloader-gui/releases/latest"
  );
});

$(".content .ui.about").on("click", 'a[href^="http"]', function (e) {
  e.preventDefault();
  shell.openExternal(this.href);
});

// Global dimmer click handler to force cleanup
$(document).on('click', '.ui.dimmer', function (e) {
  if (e.target === this) {
    cleanupModalDimmers();
    $('.ui.modal').modal('hide');
  }
});

function cleanupModalDimmers() {
  // Clean up dimmers but don't break modal functionality
  $('.ui.dimmer').removeClass('active visible').hide();
  $('.ui.page.dimmer').removeClass('active visible').hide();
  $('.ui.modals.dimmer').removeClass('active visible').hide();
  $('.ui.dimmer.modals.page.transition.visible.active').removeClass('active visible').hide();
  $('.ui.dimmer.modals.page.transition.visible').removeClass('active visible').hide();
  $('.ui.dimmer.modals.page').removeClass('active visible').hide();
  $('.ui.dimmer.modals').removeClass('active visible').hide();
  $('.ui.dimmer.page').removeClass('active visible').hide();

  // Remove any remaining dimmers with different selectors
  $('[class*="dimmer"]').removeClass('active visible').hide();

  // Don't remove modal classes - just clean up dimmers
  // $('.ui.modal').removeClass('visible active'); // REMOVED
  // $('[class*="modal"]').removeClass('visible active'); // REMOVED
}

function showToast(message) {
  const container = document.getElementById('toaster-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
  }, 100);

  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  }, 4000);
}

$(".ui.settings .form").submit(e => {
  e.preventDefault();
  var enableDownloadStartEnd = $(e.target).find(
    'input[name="enabledownloadstartend"]'
  )[0].checked;
  var skipAttachments = $(e.target).find('input[name="skipattachments"]')[0]
    .checked;
  var skipSubtitles = $(e.target).find('input[name="skipsubtitles"]')[0]
    .checked;
  var autoRetry = $(e.target).find('input[name="autoretry"]')[0].checked;
  var downloadStart =
    parseInt(
      $(e.target)
        .find('input[name="downloadstart"]')
        .val()
    ) || false;
  var downloadEnd =
    parseInt(
      $(e.target)
        .find('input[name="downloadend"]')
        .val()
    ) || false;
  var videoQuality =
    $(e.target)
      .find('input[name="videoquality"]')
      .val() || false;
  var downloadPath =
    $(e.target)
      .find('input[name="downloadpath"]')
      .val() || false;
  var language =
    $(e.target)
      .find('input[name="language"]')
      .val() || false;

  settings.set("download", {
    enableDownloadStartEnd: enableDownloadStartEnd,
    skipAttachments: skipAttachments,
    skipSubtitles: skipSubtitles,
    autoRetry: autoRetry,
    downloadStart: downloadStart,
    downloadEnd: downloadEnd,
    videoQuality: videoQuality,
    path: downloadPath
  });

  settings.set("general", {
    language: language
  });

  showToast(translate("Settings Saved"));
});

var settingsForm = $(".ui.settings .form");

function loadSettings() {
  var settingsCached = settings.getAll();
  if (settingsCached.download.enableDownloadStartEnd) {
    settingsForm
      .find('input[name="enabledownloadstartend"]')
      .prop("checked", true);
  } else {
    settingsForm
      .find('input[name="enabledownloadstartend"]')
      .prop("checked", false);
    settingsForm
      .find('input[name="downloadstart"], input[name="downloadend"]')
      .prop("readonly", true);
  }

  if (settingsCached.download.skipAttachments) {
    settingsForm.find('input[name="skipattachments"]').prop("checked", true);
  } else {
    settingsForm.find('input[name="skipattachments"]').prop("checked", false);
  }

  if (settingsCached.download.skipSubtitles) {
    settingsForm.find('input[name="skipsubtitles"]').prop("checked", true);
  } else {
    settingsForm.find('input[name="skipsubtitles"]').prop("checked", false);
  }

  if (settingsCached.download.autoRetry) {
    settingsForm.find('input[name="autoretry"]').prop("checked", true);
  } else {
    settingsForm.find('input[name="autoretry"]').prop("checked", false);
  }

  settingsForm
    .find('input[name="downloadpath"]')
    .val(settingsCached.download.path || homedir + "/Downloads");
  settingsForm
    .find('input[name="downloadstart"]')
    .val(settingsCached.download.downloadStart || "");
  settingsForm
    .find('input[name="downloadend"]')
    .val(settingsCached.download.downloadEnd || "");
  var videoQuality = settingsCached.download.videoQuality;
  settingsForm.find('input[name="videoquality"]').val(videoQuality || "");
  settingsForm
    .find('input[name="videoquality"]')
    .parent(".dropdown")
    .find(".default.text")
    .html(videoQuality || translate("Auto"));
  var language = settingsCached.general.language;
  settingsForm.find('input[name="language"]').val(language || "");
  settingsForm
    .find('input[name="language"]')
    .parent(".dropdown")
    .find(".default.text")
    .html(language || "English");
}

settingsForm.find('input[name="enabledownloadstartend"]').change(function () {
  if (this.checked) {
    settingsForm
      .find('input[name="downloadstart"], input[name="downloadend"]')
      .prop("readonly", false);
  } else {
    settingsForm
      .find('input[name="downloadstart"], input[name="downloadend"]')
      .prop("readonly", true);
  }
});

function selectDownloadPath() {
  const path = dialog.showOpenDialogSync({
    properties: ["openDirectory"]
  });

  if (path[0]) {
    fs.access(path[0], fs.R_OK && fs.W_OK, function (err) {
      if (err) {
        prompt.alert(translate("Cannot select this folder"));
      } else {
        settingsForm.find('input[name="downloadpath"]').val(path[0]);
      }
    });
  }
}

function handleResponse(response, keyword = "") {
  $(".ui.dashboard .courses.dimmer").removeClass("active");
  $(".ui.dashboard .ui.courses.section .disposable").remove();
  $(".ui.dashboard .ui.courses.section .ui.courses.items").empty();
  if (response.results.length) {
    $.each(response.results, function (index, course) {
      $(".ui.dashboard .ui.courses.section .ui.courses.items").append(`
                  <div class="ui course item course-item" course-id="${course.id
        }" course-url="${course.url}">
                  <div class="ui tiny label download-quality grey"></div>
                  <div class="ui tiny grey label download-speed"><span class="value">0</span> KB/s</div>
                    <div class="ui tiny image">
                      <img src="${course.image_240x135}">
                    </div>
                    <div class="content">
                      <span class="coursename">${course.title}</span>

                    <div class="ui tiny icon green download-success message" style="display: none;">
                           <i class="check icon"></i>
                            <div class="content">
                              <div class="header">
                                 ${translate("Download Completed")}
                               </div>
                               <p>${translate("Click to dismiss")}</p>
                             </div>
                      </div>

                    <div class="ui tiny icon red download-error message" style="display: none;">
                           <i class="power off icon"></i>
                            <div class="content">
                              <div class="header">
                                 ${translate("Download Failed")}
                               </div>
                               <p>${translate("Click to retry")}</p>
                             </div>
                      </div>

                      <div class="extra download-status">
                        ${downloadTemplate}
                      </div>

                    </div>
                  </div>
          `);
    });
    if (response.next) {
      $(".ui.courses.section").append(
        `<button class="ui basic blue fluid load-more button disposable" data-url=${response.next
        }>${translate("Load More")}</button>`
      );
    }
  } else {
    $(".ui.dashboard .ui.courses.section .ui.courses.items").append(
      `<div class="ui yellow message disposable">${translate(
        "No Courses Found"
      )}</div>`
    );
  }
}

function saveDownloads(quit) {
  var downloadedCourses = [];
  var $downloads = $(
    ".ui.downloads.section .ui.courses.items .ui.course.item"
  ).slice(0, 50);
  if ($downloads.length) {
    $downloads.each(function (index, elem) {
      $elem = $(elem);
      if ($elem.find(".progress.active").length) {
        var individualProgress = $elem
          .find(".download-status .individual.progress")
          .attr("data-percent");
        var combinedProgress = $elem
          .find(".download-status .combined.progress")
          .attr("data-percent");
        var completed = false;
      } else {
        var individualProgress = 0;
        var combinedProgress = 0;
        var completed = true;
      }
      var course = {
        id: $elem.attr("course-id"),
        url: $elem.attr("course-url"),
        title: $elem.find(".coursename").text(),
        image: $elem.find(".image img").attr("src"),
        individualProgress: individualProgress,
        combinedProgress: combinedProgress,
        completed: completed,
        progressStatus: $elem.find(".download-status .label").text()
      };
      downloadedCourses.push(course);
    });
    settings.set("downloadedCourses", downloadedCourses);
  }
  if (quit) {
    electron.ipcRenderer.send("quitApp");
  }
}

function loadDownloads() {
  const downloadsList = $('#downloads-list');
  downloadsList.empty();

  const downloadedFiles = settings.get('downloadedFiles') || [];

  if (downloadedFiles.length === 0) {
    downloadsList.html(`
      <div class="empty-downloads">
        <i class="download icon"></i>
        <h3>No Downloads Yet</h3>
        <p>Your downloaded content will appear here</p>
      </div>
    `);
    updateDownloadStats(0, 0, 0);
    return;
  }

  // Remove duplicates based on lectureId
  const uniqueFiles = downloadedFiles.filter((file, index, self) =>
    index === self.findIndex(f => f.lectureId === file.lectureId)
  );

  // Group downloads by course
  const courseGroups = {};
  let totalSize = 0;

  uniqueFiles.forEach(file => {
    if (!courseGroups[file.courseTitle]) {
      courseGroups[file.courseTitle] = [];
    }
    courseGroups[file.courseTitle].push(file);

    // Calculate file size if available
    if (file.fileSize) {
      totalSize += file.fileSize;
    }
  });

  // Create download items grouped by course
  Object.keys(courseGroups).forEach(courseTitle => {
    const courseFiles = courseGroups[courseTitle];

    // Add course header
    const courseHeader = $(`
      <div class="course-downloads-section">
        <div class="course-downloads-header">
          <h3 class="course-title">${courseTitle}</h3>
          <span class="course-file-count">${courseFiles.length} file${courseFiles.length !== 1 ? 's' : ''}</span>
                               </div>
        <div class="course-downloads-list">
                             </div>
                      </div>
    `);

    const courseDownloadsList = courseHeader.find('.course-downloads-list');

    courseFiles.forEach(file => {
      const fileExtension = file.fileExtension || '.mp4';
      const iconClass = getFileIconClass(fileExtension);
      const iconName = getFileIconName(fileExtension);
      const fileSize = formatFileSize(file.fileSize || 0);
      const downloadDate = formatDate(file.downloadedAt);

      const downloadItem = $(`
        <div class="download-item" data-file-path="${file.filePath}" data-lecture-id="${file.lectureId}">
          <div class="download-item-icon ${iconClass}">
            <i class="${iconName} icon"></i>
                               </div>
          <div class="download-item-content">
            <div class="download-item-title">${file.lectureTitle}</div>
            <div class="download-item-details">
              <span class="download-item-section">${file.sectionName}</span>
              <span class="download-item-size">${fileSize}</span>
              <span class="download-item-date">${downloadDate}</span>
                             </div>
                      </div>
          <div class="download-item-actions">
            <button class="ui button open open-file-btn" data-file-path="${file.filePath}">
              <i class="folder open icon"></i>
              Open
            </button>
            <button class="ui button delete delete-file-btn" data-lecture-id="${file.lectureId}" data-file-path="${file.filePath}">
              <i class="trash icon"></i>
              Delete
            </button>
                    </div>
                  </div>
          `);

      courseDownloadsList.append(downloadItem);
    });

    downloadsList.append(courseHeader);
  });

  updateDownloadStats(uniqueFiles.length, totalSize, Object.keys(courseGroups).length);
}

function updateDownloadStats(totalFiles, totalSizeBytes, totalCourses) {
  $('#total-downloads').text(totalFiles);
  $('#total-size').text(formatFileSize(totalSizeBytes));
  $('#total-courses').text(totalCourses);
}

function getFileIconClass(fileExtension) {
  const ext = fileExtension.toLowerCase();
  if (ext === '.mp4' || ext === '.avi' || ext === '.mov' || ext === '.mkv') return 'video';
  if (ext === '.html' || ext === '.txt' || ext === '.md') return 'article';
  if (ext === '.pdf' || ext === '.doc' || ext === '.docx') return 'file';
  if (ext === '.epub' || ext === '.mobi') return 'ebook';
  if (ext === '.mp3' || ext === '.wav' || ext === '.aac') return 'audio';
  return 'file';
}

function getFileIconName(fileExtension) {
  const ext = fileExtension.toLowerCase();
  if (ext === '.mp4' || ext === '.avi' || ext === '.mov' || ext === '.mkv') return 'file video';
  if (ext === '.html' || ext === '.txt' || ext === '.md') return 'file text';
  if (ext === '.pdf' || ext === '.doc' || ext === '.docx') return 'file';
  if (ext === '.epub' || ext === '.mobi') return 'book';
  if (ext === '.mp3' || ext === '.wav' || ext === '.aac') return 'volume up';
  return 'file';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function openDownloadedFile(filePath) {
  console.log('Attempting to open file:', filePath);

  // Ensure the file path is properly formatted for Windows
  if (filePath && typeof filePath === 'string') {
    // Remove any potential escaping and normalize the path
    const cleanPath = filePath.replace(/\\/g, '/').replace(/"/g, '');
    console.log('Cleaned file path:', cleanPath);

    electron.ipcRenderer.send('open-external-file', cleanPath);
    showToast('Opening file...');
  } else {
    console.error('Invalid file path:', filePath);
    showToast('Invalid file path', 'error');
  }
}

function deleteDownloadedFile(lectureId, filePath) {
  prompt.confirm("Are you sure you want to delete this file?", function (ok) {
    if (ok) {
      electron.ipcRenderer.send('delete-downloaded-file', { lectureId, filePath });
    }
  });
}

function clearAllDownloads() {
  prompt.confirm("Are you sure you want to delete all downloaded files? This action cannot be undone.", function (ok) {
    if (ok) {
      electron.ipcRenderer.send('clear-all-downloads');
    }
  });
}

function refreshDownloads() {
  loadDownloads();
  showToast('Downloads refreshed');
}

function validURL(value) {
  var expression = /[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi;
  var regexp = new RegExp(expression);
  return regexp.test(value);
}

function search(keyword, headers) {
  $.ajax({
    type: "GET",
    url: `https://${subDomain}.udemy.com/api-2.0/users/me/subscribed-courses?page_size=50&page=1&fields[user]=job_title&search=${keyword}`,
    beforeSend: function () {
      $(".ui.dashboard .courses.dimmer").addClass("active");
    },
    headers: headers,
    success: function (response) {
      handleResponse(response, keyword);
    }
  });
}

function loadDefaults() {
  settings.set("download", {
    enableDownloadStartEnd: false,
    skipAttachments: false,
    skipSubtitles: false,
    autoRetry: false,
    downloadStart: false,
    downloadEnd: false,
    videoQuality: false,
    path: false
  });

  settings.set("general", {
    language: false
  });
}

if (!settings.get("general")) {
  loadDefaults();
}

function askforSubtile(availableSubs, initDownload, $course, coursedata) {
  var $subtitleModal = $(".ui.subtitle.modal");
  var $subtitleDropdown = $subtitleModal.find(".ui.dropdown");
  var subtitleLanguages = [];
  for (var key in availableSubs) {
    subtitleLanguages.push({
      name: `<b>${key}</b> <i>${availableSubs[key]} Lectures</i>`,
      value: key
    });
  }
  $subtitleModal.modal({ closable: false }).modal("show");
  $subtitleDropdown.dropdown({
    values: subtitleLanguages,
    onChange: function (subtitle) {
      $subtitleModal.modal("hide");
      $subtitleDropdown.dropdown({ values: [] });
      initDownload($course, coursedata, subtitle);
    }
  });
}

function loginWithUdemy() {
  if ($(".ui.login #business").is(":checked")) {
    if ($subDomain.val() == "") {
      prompt.alert(translate("Please enter your business name"));
      return;
    }
    subDomain = $subDomain.val();
  } else {
    subDomain = "www";
  }

  if (loginWindow) {
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 450,
    height: 650,
    webPreferences: {
      nodeIntegration: false,
      preload: __dirname + "/assets/js/login.js"
    }
  });
  loginWindow.setMenu(null);
  loginWindow.loadURL(`https://${subDomain}.udemy.com`);
  $(".ui.login.dimmer").addClass("active");
  loginWindow.webContents.on("did-finish-load", function () {
    if (
      !loginWindow.webContents
        .getURL()
        .includes(`https://${subDomain}.udemy.com`)
    ) {
      prompt.alert(
        translate("You have been redirected to an untrusted URL. Closing...")
      );
      loginWindow.close();
    }
  });

  loginWindow.on("close", function () {
    loginWindow = null;
    $(".ui.login.dimmer").removeClass("active");
  });
}

function checkLogin() {
  if (settings.get("access_token")) {
    $(".ui.login.grid").slideUp("fast");
    $(".ui.dashboard")
      .fadeIn("fast")
      .css("display", "flex");

    // Ensure only courses section is visible on initial load
    $(".main-content .ui.section").hide();
    $(".main-content .ui.courses.section").show();
    $(".bottom-nav .active").removeClass("active");
    $(".bottom-nav .courses-sidebar").addClass("active");

    headers = { Authorization: `Bearer ${settings.get("access_token")}` };
    $.ajax({
      type: "GET",
      url: `https://${settings.get(
        "subdomain"
      )}.udemy.com/api-2.0/users/me/subscribed-courses?page_size=50`,
      beforeSend: function () {
        $(".ui.dashboard .courses.dimmer").addClass("active");
      },
      headers: headers,
      success: function (response) {
        handleResponse(response);
      },
      error: function (response) {
        if (response.status == 403 || response.status == 401) {
          prompt.alert(translate("Invalid Access Token"));
          settings.set("access_token", false);
        }
        resetToLogin();
      }
    });
  }
}

function loginWithAccessToken() {
  if (
    $(".ui.login #business").is(":checked")
  ) {
    if (!$subDomain.val()) {
      prompt.alert(translate("Please enter your business name"));
      return;
    }
  }
  prompt.prompt(translate("Access Token"), function (access_token) {
    if (access_token) {
      settings.set("access_token", access_token);
      if ($(".ui.login #business").is(":checked")) {
        settings.set("subdomain", $subDomain.val());
      } else {
        settings.set("subdomain", 'www');
      }
      checkLogin();
    }
  });
}

function resetToLogin() {
  $(".ui.dimmer").removeClass("active");
  $(".ui.dashboard .courses.items").empty();
  $(".content .ui.section").hide();
  $(".content .ui.courses.section").show();
  $(".sidebar")
    .find(".active")
    .removeClass("active");
  $(".sidebar")
    .find(".courses-sidebar")
    .addClass("active");
  $(".ui.login.grid").slideDown("fast");
  $(".ui.dashboard").fadeOut("fast");
}

const searchInput = document.querySelector('.courses.section .search.form .prompt');
const coursesItems = document.querySelector('.courses.items');

searchInput.addEventListener('input', function () {
  const searchTerm = this.value.toLowerCase();
  const allCourses = coursesItems.querySelectorAll('.course.item');

  allCourses.forEach(course => {
    const courseName = course.querySelector('.coursename').textContent.toLowerCase();
    if (courseName.includes(searchTerm)) {
      course.style.display = 'flex';
    } else {
      course.style.display = 'none';
    }
  });
});

const getLectureDownloadUrl = (courseId, lectureId) => {
  return new Promise((resolve, reject) => {
    const apiUrl = `https://${settings.get("subdomain") || 'www'}.udemy.com/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?fields[lecture]=asset&fields[asset]=@min,download_urls,external_url,stream_urls`;

    console.log('Fetching download URL for lecture:', lectureId, 'in course:', courseId);
    console.log('API URL:', apiUrl);

    $.ajax({
      url: apiUrl,
      type: 'GET',
      headers: headers,
      success: function (response) {
        console.log('=== FULL API Response for lecture', lectureId, '===');
        console.log('Response:', JSON.stringify(response, null, 2));

        if (!response.asset) {
          console.error('No asset found in response for lecture:', lectureId);
          resolve(null);
          return;
        }

        console.log('Asset found:', JSON.stringify(response.asset, null, 2));

        // Try multiple ways to get the download URL
        let downloadUrl = null;

        // Method 1: Check download_urls.Video (most common)
        if (response.asset.download_urls && response.asset.download_urls.Video && response.asset.download_urls.Video.length > 0) {
          const settingsCached = settings.get('download');
          const videoQuality = settingsCached.videoQuality;
          const videos = response.asset.download_urls.Video;
          let video;

          console.log('Found Video download_urls:', videos);

          if (videoQuality && videoQuality !== 'Auto') {
            video = videos.find(v => v.label === videoQuality);
            console.log('Looking for quality:', videoQuality, 'Found:', video);
          }

          if (!video) {
            // Default to highest quality
            video = videos.sort((a, b) => parseInt(b.label) - parseInt(a.label))[0];
            console.log('Selected highest quality video:', video);
          }

          downloadUrl = video.file;
          console.log('Found download URL via download_urls.Video:', downloadUrl);
        }

        // Method 2: Check stream_urls (alternative method)
        else if (response.asset.stream_urls && response.asset.stream_urls.Video && response.asset.stream_urls.Video.length > 0) {
          const videos = response.asset.stream_urls.Video;
          console.log('Found Video stream_urls:', videos);
          const video = videos.sort((a, b) => parseInt(b.label) - parseInt(a.label))[0];
          downloadUrl = video.file;
          console.log('Found download URL via stream_urls.Video:', downloadUrl);
        }

        // Method 3: Check external_url (for external videos)
        else if (response.asset.external_url) {
          downloadUrl = response.asset.external_url;
          console.log('Found download URL via external_url:', downloadUrl);
        }

        // Method 4: Check if there are any download URLs at all
        else if (response.asset.download_urls) {
          // Look for any available download URL
          const downloadTypes = Object.keys(response.asset.download_urls);
          console.log('Available download types:', downloadTypes);

          for (const type of downloadTypes) {
            if (response.asset.download_urls[type] && response.asset.download_urls[type].length > 0) {
              downloadUrl = response.asset.download_urls[type][0].file;
              console.log('Found download URL via', type, ':', downloadUrl);
              break;
            }
          }
        }

        // Method 5: Check for any other URL fields
        else {
          console.log('Checking for other URL fields in asset...');
          const urlFields = ['url', 'file', 'download_url', 'stream_url'];
          for (const field of urlFields) {
            if (response.asset[field]) {
              downloadUrl = response.asset[field];
              console.log('Found download URL via', field, ':', downloadUrl);
              break;
            }
          }
        }

        if (downloadUrl) {
          console.log('Successfully resolved download URL:', downloadUrl);
          resolve(downloadUrl);
        } else {
          console.error('=== NO DOWNLOAD URL FOUND ===');
          console.error('Lecture ID:', lectureId);
          console.error('Course ID:', courseId);
          console.error('Asset structure:', JSON.stringify(response.asset, null, 2));
          console.error('Asset keys:', Object.keys(response.asset));
          if (response.asset.download_urls) {
            console.error('Download URLs keys:', Object.keys(response.asset.download_urls));
          }
          resolve(null);
        }
      },
      error: function (err) {
        console.error('Error fetching lecture download URL for lecture', lectureId, ':', err);
        console.error('Error details:', err.responseText || err.statusText);
        console.error('Error status:', err.status);
        reject(err);
      }
    });
  });
};

$(document).on('click', '.open-file-btn', function () {
  const filePath = $(this).data('file-path');
  openDownloadedFile(filePath);
});

$(document).on('click', '.delete-file-btn', function () {
  const lectureId = $(this).data('lecture-id');
  const filePath = $(this).data('file-path');
  deleteDownloadedFile(lectureId, filePath);
});

$(document).on('click', '.download-all-btn', function () {
  const button = $(this);
  const modal = button.closest('.ui.modal.video-list-popup');
  const courseTitle = modal.find('.header span').text();

  button.text('Starting...').prop('disabled', true);

  // Get all downloadable buttons
  const downloadButtons = modal.find('.download-video-btn, .download-file-btn, .download-ebook-btn, .download-audio-btn, .download-article-btn');

  if (downloadButtons.length === 0) {
    showToast('No downloadable content found.', 'error');
    button.text('Download All').prop('disabled', false);
    return;
  }

  let downloadCount = 0;
  let totalDownloads = downloadButtons.length;

  showToast(`Starting download of ${totalDownloads} items...`);

  // Process downloads sequentially to avoid overwhelming the system
  const processNextDownload = (index) => {
    if (index >= downloadButtons.length) {
      showToast(`Started download of ${downloadCount} items.`);
      button.text('Download All').prop('disabled', false);
      return;
    }

    const downloadBtn = $(downloadButtons[index]);

    // Skip if already downloaded
    if (downloadBtn.hasClass('open-file-btn')) {
      processNextDownload(index + 1);
      return;
    }

    // Simulate click on the download button
    downloadBtn.trigger('click');

    // Wait a bit before processing the next download
    setTimeout(() => {
      downloadCount++;
      processNextDownload(index + 1);
    }, 1000); // 1 second delay between downloads
  };

  // Start the download process
  processNextDownload(0);
});

// Download management event listeners
electron.ipcRenderer.on('download-deleted', (event, { lectureId, success, error }) => {
  if (success) {
    showToast('File deleted successfully');
    loadDownloads(); // Refresh the downloads list
  } else {
    showToast(`Failed to delete file: ${error}`, 'error');
  }
});

electron.ipcRenderer.on('all-downloads-cleared', (event, { success, deletedCount, errorCount, totalFiles, error }) => {
  if (success) {
    showToast(`Cleared ${deletedCount} files${errorCount > 0 ? ` (${errorCount} errors)` : ''}`);
    loadDownloads(); // Refresh the downloads list
  } else {
    showToast(`Failed to clear downloads: ${error}`, 'error');
  }
});

// Handle file open errors from main process
electron.ipcRenderer.on('file-open-error', (event, { error, path }) => {
  console.error('File open error:', error, 'Path:', path);
  showToast(`Could not open file: ${error}`, 'error');
});
