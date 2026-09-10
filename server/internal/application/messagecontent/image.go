package messagecontent

import (
	"errors"
	"strings"
	"unicode/utf8"

	"app/internal/messageformat"
)

const imageMessageSummaryPrefix = "[图片]"
const videoMessageSummaryPrefix = "[视频]"

type ImageCaption struct {
	Content     string
	ContentType string
}

func NormalizeImageCaption(content string, contentType string) (ImageCaption, error) {
	return normalizeMediaCaption(content, contentType, "图片")
}

func NormalizeVideoCaption(content string, contentType string) (ImageCaption, error) {
	return normalizeMediaCaption(content, contentType, "视频")
}

func normalizeMediaCaption(content string, contentType string, mediaName string) (ImageCaption, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return ImageCaption{}, nil
	}
	if utf8.RuneCountInString(content) > maxTextLength {
		return ImageCaption{}, errors.New(mediaName + "说明不能超过 5000 个字符")
	}

	contentType = strings.ToLower(strings.TrimSpace(contentType))
	if contentType == "" {
		contentType = TypeText
	}
	if contentType != TypeText && contentType != TypeMarkdown {
		return ImageCaption{}, errors.New(mediaName + "说明类型只能是 text 或 markdown")
	}

	return ImageCaption{Content: content, ContentType: contentType}, nil
}

func ImageMessageSummary(caption ImageCaption) (string, error) {
	return mediaMessageSummary(imageMessageSummaryPrefix, caption)
}

func VideoMessageSummary(caption ImageCaption) (string, error) {
	return mediaMessageSummary(videoMessageSummaryPrefix, caption)
}

func mediaMessageSummary(prefix string, caption ImageCaption) (string, error) {
	if caption.Content == "" {
		return prefix, nil
	}

	summary := caption.Content
	if caption.ContentType == TypeMarkdown {
		plainText, err := messageformat.MarkdownPlainText(caption.Content)
		if err != nil {
			return "", err
		}
		summary = plainText
	}
	summary = strings.TrimSpace(summary)
	if summary == "" {
		return prefix, nil
	}
	return prefix + " " + summary, nil
}
