## 1\. Introduction[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Introduction)

Images play a very important role in visual applications. Whether it's a picture or a video, since a video is essentially a series of frames, image processing is the foundation of visual applications.

## 2\. API Documentation[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#API-Documentation)

This document introduces common methods. For more APIs, refer to the documentation of the maix.image module.

## 3\. Image Formats[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Image-Formats)

MaixPy provides a basic image module `image`, where the most important part is the `image.Image` class, which is used for image creation and various basic image operations, as well as image loading and saving.

There are many image formats, and we generally use `image.Format.FMT_RGB888` or `image.Format.FMT_RGBA8888` or `image.Format.FMT_GRAYSCALE` or `image.Format.FMT_BGR888`, etc.

We all know that the three colors `RGB` can synthesize any color, so in most cases, we use `image.Format.FMT_RGB888`, which is sufficient. `RGB888` is `RGB packed` in memory, i.e., the arrangement in memory is:  
`pixel1_red, pixel1_green, pixel1_blue, pixel2_red, pixel2_green, pixel2_blue, ...` arranged in sequence.

## 4\. Creating an Image[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Creating-an-Image)

Creating an image is very simple, you only need to specify the width and height of the image, and the image format:

```python
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
print(img)
print(img.width(), img.height(), img.format())
```

`320` is the width of the image, `240` is the height of the image, and `image.Format.FMT_RGB888` is the format of the image. The format parameter can be omitted, and the default is `image.Format.FMT_RGB888`.

Here, you can get the width, height, and format of the image using `img.width()`, `img.height()`, and `img.format()`.

## 5\. Displaying on the Screen[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Displaying-on-the-Screen)

MaixPy provides the `maix.display.Display` class, which can conveniently display images:

```java
from maix import image, display

disp = display.Display()

img = image.Image(320, 240, image.Format.FMT_RGB888)
disp.show(img)
```

Note that here, since there is no image data, a black image is displayed. See the following sections for how to modify the image.

## 6\. Reading Images from the File System[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Reading-Images-from-the-File-System)

MaixPy provides the `maix.image.load` method, which can read images from the file system:

```python
from maix import image

img = image.load("/root/image.jpg")
if img is None:
    raise Exception(f"load image failed")
print(img)
```

Note that here, `/root/image.jpg` has been transferred to the board in advance. You can refer to the previous tutorials for the method.  
It supports `jpg` and `png` image formats.

## 7\. Saving Images to the File System[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Saving-Images-to-the-File-System)

MaixPy's `maix.image.Image` provides the `save` method, which can save images to the file system:

```python
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)

# do something with img
img.save("/root/image.jpg")
```

## 8\. Drawing Rectangles[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Drawing-Rectangles)

`image.Image` provides the `draw_rect` method, which can draw rectangles on the image:

```java
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img.draw_rect(10, 10, 100, 100, image.Color.from_rgb(255, 0, 0))
```

Here, the parameters are: `x`, `y`, `w`, `h`, `color`. `x` and `y` are the coordinates of the top-left corner of the rectangle, `w` and `h` are the width and height of the rectangle, and `color` is the color of the rectangle, which can be created using the `image.Color.from_rgb` method.  
You can specify the line width of the rectangle using `thickness`, which defaults to `1`.

You can also draw a solid rectangle by passing `thickness=-1`:

```java
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img.draw_rect(10, 10, 100, 100, (255, 0, 0), thickness=-1)
```

## 9\. Writing Strings[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Writing-Strings)

`image.Image` provides the `draw_string` method, which can write text on the image:

```java
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img.draw_string(10, 10, "Hello MaixPy", image.Color.from_rgb(255, 0, 0))
```

Here, the parameters are: `x`, `y`, `text`, `color`. `x` and `y` are the coordinates of the top-left corner of the text, `text` is the text to be written, and `color` is the color of the text, which can be created using the `image.Color.from_rgb` method.

You can also enlarge the font by passing the `scale` parameter:

```less
img.draw_string(10, 10, "Hello MaixPy", image.Color.from_rgb(255, 0, 0), scale=2)
```

Get the width and height of the font:

```bash
w, h = img.string_size("Hello MaixPy", scale=2)
print(w, h)
```

**Note** that here, `scale` is the magnification factor, and the default is `1`. It should be consistent with `draw_string`.

## 10\. Chinese support and custom fonts[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Chinese-support-and-custom-fonts)

The `image` module supports loading `ttf/otf` fonts. The default font only supports English. If you want to display Chinese or custom fonts, you can first download the font file to the device and then load the font.  
The system also has several built-in fonts, under the `/maixapp/share/font` directory, code example:

```lua
from maix import image, display, app, time

image.load_font("sourcehansans", "/maixapp/share/font/SourceHanSansCN-Regular.otf", size = 32)
print("fonts:", image.fonts())
image.set_default_font("sourcehansans")

disp = display.Display()

img = image.Image(disp.width(), disp.height())
img.draw_string(2, 2, "Hello! Hello, world!", image.Color.from_rgba(255, 0, 0))

disp.show(img)
while not app.need_exit():
time.sleep(1)
```

Load the font file, then set the default font, or you can set the default font without setting the default font, and set the parameters in the writing function:

```less
img.draw_string(2, 2, "你好！Hello, world!", image.Color.from_rgba(255, 0, 0), font="sourcehansans")
```

Note that the `string_size` method will also use the default font to calculate the size, and you can also use the `font` parameter to set the font to be calculated separately.

## 11\. Drawing Lines[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Drawing-Lines)

`image.Image` provides the `draw_line` method, which can draw lines on the image:

```java
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img.draw_line(10, 10, 100, 100, image.Color.from_rgb(255, 0, 0))
```

Here, the parameters are: `x1`, `y1`, `x2`, `y2`, `color`. `x1` and `y1` are the coordinates of the starting point of the line, `x2` and `y2` are the coordinates of the end point of the line, and `color` is the color of the line, which can be created using the `image.Color.from_rgb` method.

## 12\. Drawing Circles[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Drawing-Circles)

`image.Image` provides the `draw_circle` method, which can draw circles on the image:

```java
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img.draw_circle(100, 100, 50, image.Color.from_rgb(255, 0, 0))
```

Here, the parameters are: `x`, `y`, `r`, `color`. `x` and `y` are the coordinates of the center of the circle, `r` is the radius, and `color` is the color of the circle, which can be created using the `image.Color.from_rgb` method.

## 13\. Resizing Images[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Resizing-Images)

`image.Image` provides the `resize` method, which can resize images:

```python
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img_new = img.resize(160, 120)
print(img, img_new)
```

Note that here, the `resize` method returns a new image object, and the original image remains unchanged.

## 14\. Cropping Images[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Cropping-Images)

`image.Image` provides the `crop` method, which can crop images:

```python
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img_new = img.crop(10, 10, 100, 100)
print(img, img_new)
```

Note that here, the `crop` method returns a new image object, and the original image remains unchanged.

## 15\. Rotating Images[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Rotating-Images)

`image.Image` provides the `rotate` method, which can rotate images:

```python
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img_new = img.rotate(90)
print(img, img_new)
```

Note that here, the `rotate` method returns a new image object, and the original image remains unchanged.

## 16\. Copying Images[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Copying-Images)

`image.Image` provides the `copy` method, which can copy an independent image:

```go
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888) 
img_new = img.copy()
print(img, img_new)
```

## 17\. Affine Transformations[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Affine-Transformations)

`image.Image` provides the `affine` method, which can perform affine transformations. By providing the coordinates of three or more points in the current image and the corresponding coordinates in the target image, you can automatically perform operations such as rotation, scaling, and translation on the image to transform it into the target image:

```python
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img_new = img.affine([(10, 10), (100, 10), (10, 100)], [(10, 10), (100, 20), (20, 100)])
print(img, img_new)
```

For more parameters and usage, please refer to the API documentation.

## 18\. Drawing Keypoints[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Drawing-Keypoints)

`image.Image` provides the `draw_keypoints` method, which can draw keypoints on the image:

```python
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)

keypoints = [10, 10, 100, 10, 10, 100]
img.draw_keypoints(keypoints, image.Color.from_rgb(255, 0, 0), size=10, thickness=1, fill=False)
```

This draws three red keypoints at the coordinates `(10, 10)`, `(100, 10)`, and `(10, 100)`. The size of the keypoints is `10`, the line width is `1`, and they are not filled.

## 19\. Drawing Crosses[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Drawing-Crosses)

`image.Image` provides the `draw_cross` method, which can draw crosses on the image:

```java
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img.draw_cross(100, 100, image.Color.from_rgb(255, 0, 0), size=5, thickness=1)
```

This draws a red cross at the coordinate `(100, 100)`. The extension size of the cross is `5`, so the length of the line segment is `2 * size + thickness`, and the line width is `1`.

## 20\. Drawing Arrows[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Drawing-Arrows)

`image.Image` provides the `draw_arrow` method, which can draw arrows on the image:

```java
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img.draw_arrow(10, 10, 100, 100, image.Color.from_rgb(255, 0, 0), thickness=1)
```

This draws a red arrow starting from the coordinate `(10, 10)`, with the end point at `(100, 100)`, and a line width of `1`.

## 21\. Drawing Images[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Drawing-Images)

`image.Image` provides the `draw_image` method, which can draw images on the image:

```java
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img2 = image.Image(100, 100, image.Format.FMT_RGB888)
img2.draw_rect(10, 10, 90, 90, image.Color.from_rgb(255, 0, 0))
img.draw_image(10, 10, img2)
```

## 22\. Converting Formats[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Converting-Formats)

`image.Image` provides the `to_format` method, which can convert image formats:

```python
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
img_new = img.to_format(image.Format.FMT_BGR888)
print(img, img_new)
img_jpg = img.to_format(image.Format.FMT_JPEG)
print(img, img_new)
```

Note that here, the `to_format` method returns a new image object, and the original image remains unchanged.

## 23\. Converting between Numpy/OpenCV and maix.image.Image Formats[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Converting-between-Numpy/OpenCV-and-maix.image.Image-Formats)

Refer to [MaixPy use OpenCV documentation](https://wiki.sipeed.com/maixpy/doc/en/vision/opencv.html)

## 24\. Converting between bytes Data[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#Converting-between-bytes-Data)

`image.Image` provides the `to_bytes` method, which can convert an image to `bytes` data:

```python
from maix import image

img = image.Image(320, 240, image.Format.FMT_RGB888)
data = img.to_bytes()
print(type(data), len(data), img.data_size())

img_jpeg = image.from_bytes(320, 240, image.Format.FMT_RGB888, data)
print(img_jpeg)
img = img_jpeg.to_format(image.Format.FMT_RGB888)
print(img)
```

Here, `to_bytes` returns a new `bytes` object, which is independent memory and does not affect the original image.  
The `image.Image` constructor can directly construct an image object from `bytes` data by passing the `data` parameter. Note that the new image is also independent memory and does not affect `data`.

Since memory copying is involved, this method is relatively time-consuming and should not be used frequently.

> If you want to optimize your program without copying (not recommended for casual use, as poorly written code can easily cause crashes), please refer to the API documentation.

## 25\. More Basic API Usage[#](https://wiki.sipeed.com/maixpy/doc/en/vision/image_ops.html#More-Basic-API-Usage)

For more API usage, please refer to the documentation of the maix.image module.