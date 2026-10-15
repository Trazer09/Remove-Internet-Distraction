/*
 * Feature catalogue for Remove Internet Distraction.
 * Keep this file browser-neutral: popup.js uses it to draw the switches, while
 * content.js uses the same IDs to assign and apply individual filter rules.
 */

(() => {
    'use strict';
    globalThis.FOCUS_FILTER_FEATURES = {
        "youtube": {
            "title": "YouTube",
            "description": "Control each distraction independently.",
            "features": [
                {
                    "id": "ads",
                    "label": "Ads & promotions",
                    "description": "Hide ad slots, promotional shelves, and promoted results."
                },
                {
                    "id": "shorts",
                    "label": "Shorts",
                    "description": "Remove Shorts videos, shelves, tabs, and navigation links."
                },
                {
                    "id": "hoverPreviews",
                    "label": "Hover previews",
                    "description": "Disable thumbnail autoplay and hover preview overlays."
                },
                {
                    "id": "homepage",
                    "label": "Home recommendations",
                    "description": "Hide the home feed or apply the supplied minimal-home rules."
                },
                {
                    "id": "relatedVideos",
                    "label": "Related videos & sidebar",
                    "description": "Hide the watch-page recommendations sidebar."
                },
                {
                    "id": "navigation",
                    "label": "Navigation & side menu",
                    "description": "Hide selected navigation links and menu sections."
                },
                {
                    "id": "playerOverlays",
                    "label": "Player end screen & cards",
                    "description": "Hide end-screen suggestions, cards, and pause overlays."
                },
                {
                    "id": "likes",
                    "label": "Like button text",
                    "description": "Hide the like-button text targeted by your list."
                },
                {
                    "id": "comments",
                    "label": "Comments",
                    "description": "Hide comments, comment previews, and comment threads."
                },
                {
                    "id": "searchSuggestions",
                    "label": "Search suggestions",
                    "description": "Hide autocomplete and search suggestion UI."
                },
                {
                    "id": "searchResults",
                    "label": "Search result extras",
                    "description": "Hide promoted results, shelves, and continuation items."
                },
                {
                    "id": "subscriptions",
                    "label": "Subscription feed extras",
                    "description": "Hide Shorts and badge-marked items in subscriptions."
                },
                {
                    "id": "channelRecommendations",
                    "label": "Channel & related recommendations",
                    "description": "Hide “for you”, playlist suggestions, and related cards."
                },
                {
                    "id": "videoMetadata",
                    "label": "Video metadata & extra panels",
                    "description": "Hide selected metadata, chat, and other video-page extras."
                },
                {
                    "id": "theaterMode",
                    "label": "Theater-mode layout changes",
                    "description": "Apply the supplied full-window theater-mode styling."
                },
                {
                    "id": "branding",
                    "label": "Branding & header controls",
                    "description": "Hide selected logos and header controls."
                }
            ]
        },
        "reddit": {
            "title": "Reddit",
            "description": "Choose which parts of Reddit stay visible.",
            "features": [
                {
                    "id": "homeFeed",
                    "label": "Home feed",
                    "description": "Hide the main feed container targeted by your list."
                },
                {
                    "id": "leftSidebar",
                    "label": "Left sidebar",
                    "description": "Hide the left navigation sidebar."
                },
                {
                    "id": "relatedPosts",
                    "label": "Related posts",
                    "description": "Hide related-post and discovery panels."
                },
                {
                    "id": "comments",
                    "label": "Comments",
                    "description": "Hide comment containers and comment content."
                },
                {
                    "id": "commentVoting",
                    "label": "Comment voting",
                    "description": "Hide comment vote counts."
                },
                {
                    "id": "commentActions",
                    "label": "Comment actions",
                    "description": "Hide comment, share, and voting action controls."
                },
                {
                    "id": "userMetadata",
                    "label": "Comment usernames & timestamps",
                    "description": "Hide the targeted author/time row."
                },
                {
                    "id": "redditBranding",
                    "label": "Reddit icon / branding",
                    "description": "Hide the selected Reddit icon element."
                },
                {
                    "id": "header",
                    "label": "Top header / navigation bar",
                    "description": "Hide Reddit’s top header and navigation bar elements."
                },
                {
                    "id": "subredditHeader",
                    "label": "Subreddit / post header",
                    "description": "Hide subreddit metadata rows and post-header details."
                },
                {
                    "id": "rightSidebar",
                    "label": "Right sidebar",
                    "description": "Hide the right sidebar and its discovery panels."
                },
                {
                    "id": "searchHeader",
                    "label": "Search header",
                    "description": "Hide the targeted search header area."
                },
                {
                    "id": "loginSidebar",
                    "label": "Login / logout sidebar",
                    "description": "Hide the sign-in prompt sidebar."
                }
            ]
        },
        "instagram": {
            "title": "Instagram",
            "description": "Toggle Reels and feed elements separately.",
            "features": [
                {
                    "id": "homeFeed",
                    "label": "Home feed container",
                    "description": "Apply the home-feed rule if you enable it in your list."
                },
                {
                    "id": "rightPanel",
                    "label": "Right panel & account card",
                    "description": "Hide the right-side panel and account card."
                },
                {
                    "id": "stories",
                    "label": "Stories & status bars",
                    "description": "Hide stories and profile status bars."
                },
                {
                    "id": "suggestions",
                    "label": "Suggested accounts / posts",
                    "description": "Hide the “Suggested for you” section."
                },
                {
                    "id": "reelsNavigation",
                    "label": "Reels navigation link",
                    "description": "Hide the Reels link in the left navigation."
                },
                {
                    "id": "reelsComments",
                    "label": "Reels comments button",
                    "description": "Hide the comments control on Reels."
                },
                {
                    "id": "reelsLikes",
                    "label": "Reels like button",
                    "description": "Hide the like control on Reels."
                },
                {
                    "id": "reelsSave",
                    "label": "Reels save button",
                    "description": "Hide the save control on Reels."
                },
                {
                    "id": "reelsShare",
                    "label": "Reels share button",
                    "description": "Hide the share control on Reels."
                },
                {
                    "id": "reelsProfile",
                    "label": "Reels profile avatar",
                    "description": "Hide the profile avatar overlay on Reels."
                },
                {
                    "id": "reelsMore",
                    "label": "Reels more menu",
                    "description": "Hide the three-dot menu control on Reels."
                },
                {
                    "id": "reelsOverlay",
                    "label": "Entire Reels overlay",
                    "description": "Hide the full video overlay if enabled in your list."
                }
            ]
        }
    };
})();
