from PIL import Image

img = Image.open('storage/map_page-1.png')
# central crop with many booths
crop = img.crop((250, 350, 1550, 1200))
crop = crop.resize((crop.width * 2, crop.height * 2))
crop.save('storage/map_debug_crop.png')
print(crop.size)
