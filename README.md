# Lumina Core

Advance Lumix admin and analytics deshboard for LumiX
1. DEsing system and visual aesthetic
theme: 3d hyped glassmorphism and premium dark syberpunk
vusual styles:
translucent panels using multi-layerd css box shadowns and backdrop filter (backdro-filter: blur(16px) saturate(180%).
subtle glowing 3d borders using linera grdients
smooth micro interations spring animations and 3d tilting effects on hover for cards and deshborad matircs also make this mobile frist responsive
chards and data : implement futuristic visually rich chart using reschart or chart.js styled with vibrat neon glowing gradient with cyber blue neon emerald hot pink to represnt views and category dustributions and storage anylytics
supabase integrations schema 
use this schema for all crus ops and data etc 
public.metatable
id:uuid
title:text
video_url:text
poster_url:text
category:text
actors:text[]
duration_econds:integer
views:bigint
created_at
search_text:genrated columns
exposed databse function to buind to ui triggers
publix.increment_views
public.list_categories
core admin caoabilites full crud operations
data table explorer :build an advance data grid supporting lighting fast full text search utilizing the postgres gin index filtering

make sure to do these below things in this admin page website 
1. make sure it should be mobile first responsive and 3d hyped glassmorphism style and also use all kind of laoding and percentage progress for image upload to cloudnary and video compress and conver into hls  and upload to cloudflare and cdn enable and insert final ata into suabse table too
2. make sure all field should be mandatory and for category make sure user can  selecte the multiple or single category and deselect too also can type and make new catgory too
3.after selecting the video take the duration of that video and fill in duration_seconds automatically.
4.after uplaoidng the video generate the 6 thumbnail of this video with equal percentage and show to user so user can  select one thumbnail image out of this image make this image responsive so it should look good in mobile and desktop too make sure it should be mobile first responsive for everthing 
5. once user selecte and type all fields then only enable the submit button 
6.once user click on submit button then upload the image to cloudnary and get the final url of this iamge that we wull insert into supabse and for selected video on click of submit button  first compress this video and then convert into hls and after doing this upload to cloudflare and enable cdn too .
7 once the all things get done then take the final url for video and image and insert into supabse . also handle verything with error
8. if is there any error then roll back and show the pop error message and do these all things a tproduction level in a proffessional application 
9. all in this admin application to perfrom all crud operation and on delete the record deleted that data from everwhere like cloudnary and cloudflare too
10 use pie chart and graph to show data in ui in advance form too.

make this whole desing interactive and advance with 3d hyped style and make app backend code optimized and working end to end without any issue ,also make sure whole develped should be mobile first responsive ,it should work pefectly in mobile first

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/523aeb9d-2935-4523-a6bf-c632c44f72f6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
