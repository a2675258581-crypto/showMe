/**
 * 助记口令（passphrase）用的常见英文单词表：恰好 1024 个，全小写、3–8 个字母、无重复。
 * 熵只取决于表的大小：每个随机选出的词贡献 log2(1024) = 10 位，与单词本身是否常见无关。
 */
export const PASSPHRASE_WORDS: readonly string[] = `
able acid actor adapt admit adult agent agree ahead aim air alarm album alert alien alley
alpha amber amount anchor angle animal ankle answer apple april apron arch arctic arena
argue armor army arrow art aspect atlas atom attic audio august aunt autumn avocado award
awake axis baby bacon badge bagel baker balcony ball bamboo banana band banjo bank barn
basket bath beach beacon bean bear beauty bed bee beetle begin bell belt bench berry bicycle
bird biscuit blade blanket blend bless blossom blue board boat body bonus book boot border
bottle bounce box brain branch brave bread breeze brick bridge bright broom brother brown
brush bubble bucket budget buffalo bundle burger butter button cabin cable cactus cake
calm camel camera camp canal candle candy canoe canvas canyon captain carbon card cargo
carpet carrot castle casual catalog cattle cave cedar cell cement center cereal chair chalk
champion chapter charge cheese cherry chess chicken chief child chimney choice circle
citizen city civil claim clap clay clever cliff climb clinic clock cloud clover clown club
coach coast cocoa coconut coffee coin collar colony color column comet comfort common
cookie copper coral corner cotton couch country cousin cover coyote crab cradle craft crane
crater crayon cream credit creek crew cricket crisp crown crystal cube culture cup cupboard
curious current curtain curve cushion custom cycle dance danger daring dawn daylight deer
delta denim depth desert design desk detail device diamond diary diesel dinner dipper
direct dish divide doctor dolphin domain donkey door double dragon drama drawer dream
dress drift drill drum duck dune dust eagle early earth easel echo eclipse edge effort
eight elbow elder elephant elegant elevator ember emerald empire energy engine enjoy
equal escape essay eternal evening exact exhibit exotic expert fabric fairy falcon family
famous fancy farm fashion father feather festival fever fiber fiction field figure film
final finger fire fiscal fish flag flame flash flavor fleet flight float flower fluid
flute focus fog folder forest fork fortune forum fossil fountain fox fragile frame fresh
friend frog frost fruit fuel funny gadget galaxy garden garlic gate gather gauge gecko
gentle ghost giant ginger giraffe glacier glad glass globe glory glove glow goat gold
golden good gorilla gospel grain grape graph grass gravity great green grid grocery group
guitar habit hammer hamster hand harbor harvest hawk hazel health heart helmet hero
hidden high hill history hobby hockey holiday honey hood hope horizon horse hospital
hotel hour humble hundred hungry hunter husband icon idea igloo image impact income index
indoor infant initial inner input insect island ivory jacket jaguar jar jazz jeans jelly
jewel job join journey joy judge juice jungle junior kangaroo keen kettle key kid kingdom
kitchen kite kitten kiwi knee knife koala label ladder lady lake lamp language laptop
large laser later laugh lava lawn layer leader leaf lemon lens leopard letter level
liberty library light lily limit linen lion liquid list little lizard lobster local lock
logic lonely lotus loyal lucky lunar lunch machine magic magnet maid mail mammal mango
mansion maple marble margin marine market marsh mask master matrix meadow medal melody
melon member memory mentor menu mercy merit mesh metal method middle midnight milk
million mineral minute mirror mission mixture model modern moment monkey month moon
morning mosquito motor mountain mouse movie muffin museum music mystery napkin narrow
nation native nature navy nearby neck needle neither nephew nerve nest network neutral
never night noble noodle normal north notable notice novel number nurse nutmeg oak oasis
object ocean october office olive omega onion opera option orange orbit orchard order
organ origin orphan ostrich otter outdoor oval oven owner oxygen oyster paddle page
palace palm panda panel panther paper parade parent park parrot party pasta patch path
peace peach peanut pearl pelican pencil people pepper perfect permit phone photo piano
picnic picture pigeon pillow pilot pine pink pioneer pipe pecan pizza planet plastic
plate play pledge pocket poem poet polar pond pony popcorn portal potato powder power
prairie praise present pretty price pride prince print prism prize problem program
project proud public pudding pumpkin puppy purple puzzle pyramid quality quantum quarter
queen quest quick quiet quilt quote rabbit raccoon radar radio rail rain rainbow raisin
ranch rapid raven razor ready reason record region relax remote rescue ribbon rice rich
riddle ridge rifle right river road robin robot rocket rookie room rose round royal ruby
rugby ruler saddle safari salad salmon salt sample sand satisfy sauce sausage scale
scarf scene school science scooter scout screen script season second secret section
seed senior sense series service seven shadow shallow shark shelf shell shelter sheriff
shield ship shoe short shoulder shrimp silent silk silver simple siren sister sketch ski
skill sky slender slice slogan slow small smile smoke snack snake sneaker snow soap
soccer social sock soda sofa solar soldier solid sonic soup south space spark spatial
speed sphere spice spider spike spirit sponge spoon sport spring square squirrel stable
stadium staff stage stairs stamp star station steady steam steel stem stick stock stone
story stove strategy straw stream street stripe strong student studio style sugar suit
summer summit sun sunset super supply surf surprise swallow swamp sweet swift swim
switch symbol syrup system table tackle tail talent tango tank target taxi teacher team
tennis tent term theater thunder ticket tiger timber tiny tissue title toast today toddler
tomato tongue tool tooth topic torch tornado tortoise tower town toy track tractor trade
traffic trail train travel treasure tree trend trial tribe trick trophy truck trumpet
trust truth tulip tuna tunnel turkey turtle tutor twelve twenty twin type umbrella uncle
unique unit universe update upper urban useful usual vacuum valley valve vanilla vapor
velvet venture venue verb version vessel veteran victory video village vintage violin
visit visual vital vivid vocal voice volcano voyage waffle wagon walnut wander warm
warrior water wave wealth weather wedding weekend welcome whale wheat wheel whisper
wild willow window wine winter wisdom wizard wolf wonder wood wool world yacht yard
yellow yoga young zebra zero zone zoo acorn bison cobalt dahlia fjord gravel harp iris
jasmine kayak lagoon mosaic nectar orchid pebble quartz reef thistle urchin violet walrus
yarn zenith badger beaver cinder
`
  .split(/\s+/)
  .filter(Boolean)
